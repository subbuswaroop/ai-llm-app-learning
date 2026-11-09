/**
 * Compares zero-shot and few-shot prompting on the same labelled job
 * descriptions, against a real local Ollama model.
 *
 *   npm run eval:strategies            # 3 runs per case and strategy
 *   npm run eval:strategies -- --runs 5
 *
 * Not part of `npm test`: it needs Ollama running and takes minutes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  LlmInvalidJsonError,
  LlmOutputTruncatedError,
  LlmProviderError,
  LlmTimeoutError,
} from "../src/llm/errors";
import { OllamaProvider } from "../src/llm/ollama.provider";
import { CURRENT_JOB_ANALYSIS_PROMPT_VERSION } from "../src/prompts/prompt-registry";
import {
  JobAnalysisService,
  JobAnalysisValidationError,
} from "../src/services/job-analysis.service";
import { PROMPT_STRATEGIES, type PromptStrategy } from "../src/types/prompt-strategy";
import { evalCases, type EvalCase } from "./job-analysis.cases";
import { scoreAnalysis, summarize, type RunRecord } from "./scoring";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 8_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const runsPerCase = Number(argValue("runs") ?? 3);
if (!Number.isInteger(runsPerCase) || runsPerCase < 1) {
  throw new RangeError("--runs must be a positive integer");
}

const service = new JobAnalysisService(new OllamaProvider({ timeoutMs: 180_000 }));

/** One model call, with retries for infrastructure failures only. */
async function runOnce(
  evalCase: EvalCase,
  strategy: PromptStrategy,
  run: number
): Promise<RunRecord> {
  const base = { strategy, caseId: evalCase.id, run };

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await service.analyze(evalCase.jobDescription, {
        companyContext: evalCase.companyContext,
        strategy,
      });

      return {
        ...base,
        status: "ok",
        analysis: result.data,
        score: scoreAnalysis(result.data, evalCase.expected),
        model: result.metadata.model,
        durationMs: result.metadata.durationMs,
        inputTokens: result.metadata.inputTokens,
        outputTokens: result.metadata.outputTokens,
      };
    } catch (error) {
      // The model answered, but badly. That is a real result: do not retry.
      if (error instanceof JobAnalysisValidationError) return { ...base, status: "invalid_schema" };
      // The error message includes only the content length, never the content.
      if (error instanceof LlmInvalidJsonError) {
        return { ...base, status: "invalid_json", error: error.message };
      }
      if (error instanceof LlmOutputTruncatedError) return { ...base, status: "truncated" };

      // Ollama itself failed (out of memory, crash, timeout). Not the model's
      // answer, so retry, and never count it against the strategy.
      if (error instanceof LlmProviderError || error instanceof LlmTimeoutError) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return { ...base, status: "infra_error", error: error.message.slice(0, 200) };
      }

      throw error; // a bug in our own code: stop the experiment
    }
  }
}

const fmt = (n: number, digits = 2) => (Number.isNaN(n) ? "n/a" : n.toFixed(digits));

async function main() {
  console.log(`Prompt version ${CURRENT_JOB_ANALYSIS_PROMPT_VERSION}, ${evalCases.length} cases, ${runsPerCase} runs each\n`);

  console.log("Warming up the model (not recorded)...");
  const warmup = await runOnce(
    { ...evalCases[0]!, id: "warmup" },
    "zero-shot",
    -1
  );
  console.log(`Warm-up: ${warmup.status}\n`);

  const records: RunRecord[] = [];
  const total = evalCases.length * runsPerCase * PROMPT_STRATEGIES.length;
  let done = 0;

  for (let run = 0; run < runsPerCase; run++) {
    for (const [caseIndex, evalCase] of evalCases.entries()) {
      // Alternate which strategy goes first so neither always runs "warmer".
      const order = (caseIndex + run) % 2 === 0 ? [...PROMPT_STRATEGIES] : [...PROMPT_STRATEGIES].reverse();

      for (const strategy of order) {
        const record = await runOnce(evalCase, strategy, run);
        records.push(record);
        done++;

        const detail = record.score
          ? `sen=${record.score.seniorityCorrect ? "ok " : "BAD"} rec=${fmt(record.score.recall)} ` +
            `prec=${fmt(record.score.precision)} forb=${record.score.forbiddenHits.length} ` +
            `${fmt((record.durationMs ?? 0) / 1000, 1)}s in=${record.inputTokens} out=${record.outputTokens}`
          : (record.error ?? "");
        console.log(
          `[${String(done).padStart(2)}/${total}] ${evalCase.id.padEnd(22)} ${strategy.padEnd(9)} ${record.status.padEnd(14)} ${detail}`
        );
      }
    }
  }

  const summaries = PROMPT_STRATEGIES.map((strategy) => summarize(strategy, records));

  console.log("\n=== Summary ===");
  console.table(
    summaries.map((s) => ({
      strategy: s.strategy,
      answered: s.answered,
      infraErrors: s.infraErrors,
      validJson: `${s.valid}/${s.answered}`,
      seniorityCorrect: `${s.seniorityCorrect}/${s.valid}`,
      meanRecall: fmt(s.meanRecall),
      meanPrecision: fmt(s.meanPrecision),
      runsWithForbiddenSkill: s.runsWithForbiddenSkills,
      runsMissingRequired: s.runsWithMissingRequired,
      meanSec: fmt(s.meanDurationMs / 1000, 1),
      medianSec: fmt(s.medianDurationMs / 1000, 1),
      meanInTokens: fmt(s.meanInputTokens, 0),
      meanOutTokens: fmt(s.meanOutputTokens, 0),
    }))
  );

  console.log("Per case (seniority correct / runs, forbidden-skill runs):");
  console.table(
    evalCases.map((c) => {
      const row: Record<string, string> = { case: c.id };
      for (const strategy of PROMPT_STRATEGIES) {
        const mine = records.filter((r) => r.caseId === c.id && r.strategy === strategy && r.score);
        row[strategy] =
          `sen ${mine.filter((r) => r.score!.seniorityCorrect).length}/${mine.length}, ` +
          `forb ${mine.filter((r) => r.score!.forbiddenHits.length > 0).length}`;
      }
      return row;
    })
  );

  const outDir = join(process.cwd(), "evals", "results");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `strategy-comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        model: records.find((r) => r.model)?.model ?? "unknown",
        promptVersion: CURRENT_JOB_ANALYSIS_PROMPT_VERSION,
        runsPerCase,
        cases: evalCases.map((c) => c.id),
        summaries,
        records,
      },
      null,
      2
    )
  );
  console.log(`\nSaved ${records.length} runs to ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
