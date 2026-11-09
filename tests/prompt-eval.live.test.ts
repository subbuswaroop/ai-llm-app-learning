/**
 * Live prompt evaluation: runs labelled job descriptions through a real model
 * and measures schema validity, skill precision and recall, seniority
 * accuracy and unsupported claims.
 *
 *   npm run test:live -- tests/prompt-eval.live.test.ts
 *
 * The thresholds below were fixed BEFORE the first run and must not be
 * adjusted after seeing results. A pass is evidence about this model and
 * prompt on these cases, not a guarantee. Results are written to
 * evals/results/prompt-eval-latest.json and .md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { promptEvalCases } from "../evals/prompt-eval.cases";
import {
  evaluateAnalysis,
  summarizePromptEval,
  toMarkdown,
  type PromptEvalRun,
} from "../evals/prompt-eval";
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

const RUNS_PER_CASE = 3;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 8_000;

// Thresholds, fixed before the first run.
const MIN_MEAN_SKILL_RECALL = 0.9;
const MIN_MEAN_SKILL_PRECISION = 0.9;
const MAX_SHARE_OF_RUNS_WITH_UNSUPPORTED_CLAIMS = 0.15;

const service = new JobAnalysisService(new OllamaProvider({ timeoutMs: 180_000 }));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runs: PromptEvalRun[] = [];
let ollamaFailures = 0;

type Outcome =
  | { kind: "answered"; result: Awaited<ReturnType<typeof service.analyze>> }
  | { kind: "schema_invalid"; reason: string }
  | { kind: "ollama_unavailable" };

async function analyzeWithRetry(
  jobDescription: string,
  companyContext: string | undefined,
  strategy: PromptStrategy
): Promise<Outcome> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return { kind: "answered", result: await service.analyze(jobDescription, { companyContext, strategy }) };
    } catch (error) {
      // The model answered, but not with a valid analysis: a real result.
      if (
        error instanceof JobAnalysisValidationError ||
        error instanceof LlmInvalidJsonError ||
        error instanceof LlmOutputTruncatedError
      ) {
        return { kind: "schema_invalid", reason: error.message.slice(0, 300) };
      }
      // Ollama itself failed: says nothing about the model, so retry, then give up.
      if (error instanceof LlmProviderError || error instanceof LlmTimeoutError) {
        if (attempt === MAX_ATTEMPTS) return { kind: "ollama_unavailable" };
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
  return { kind: "ollama_unavailable" };
}

afterAll(() => {
  const outDir = resolve(process.cwd(), "evals/results");
  mkdirSync(outDir, { recursive: true });

  writeFileSync(
    resolve(outDir, "prompt-eval-latest.json"),
    JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        promptVersion: CURRENT_JOB_ANALYSIS_PROMPT_VERSION,
        runsPerCase: RUNS_PER_CASE,
        ollamaFailures,
        summaries: PROMPT_STRATEGIES.map((s) => summarizePromptEval(s, runs)),
        runs,
      },
      null,
      2
    )
  );
  writeFileSync(
    resolve(outDir, "prompt-eval-latest.md"),
    toMarkdown(CURRENT_JOB_ANALYSIS_PROMPT_VERSION, promptEvalCases, runs, PROMPT_STRATEGIES) + "\n"
  );
});

describe(`prompt evaluation, prompt version ${CURRENT_JOB_ANALYSIS_PROMPT_VERSION}`, () => {
  for (let run = 0; run < RUNS_PER_CASE; run++) {
    for (const [caseIndex, evalCase] of promptEvalCases.entries()) {
      // Alternate which strategy goes first so neither always runs "warmer".
      const order = (caseIndex + run) % 2 === 0 ? [...PROMPT_STRATEGIES] : [...PROMPT_STRATEGIES].reverse();

      for (const strategy of order) {
        it(`${evalCase.id} / ${strategy} / run ${run}`, async (context) => {
          const outcome = await analyzeWithRetry(evalCase.jobDescription, evalCase.companyContext, strategy);

          if (outcome.kind === "ollama_unavailable") {
            ollamaFailures++;
            context.skip("Ollama unavailable after retries");
          }

          if (outcome.kind === "schema_invalid") {
            runs.push({ caseId: evalCase.id, strategy, run, schemaValid: false });
            expect.fail(`response was not a valid analysis: ${outcome.reason}`);
          }

          const { result } = outcome as Extract<Outcome, { kind: "answered" }>;
          const { score, claims } = evaluateAnalysis(evalCase, result.data);

          runs.push({
            caseId: evalCase.id,
            strategy,
            run,
            schemaValid: true,
            analysis: result.data,
            score,
            claims,
            durationMs: result.metadata.durationMs,
            inputTokens: result.metadata.inputTokens,
            outputTokens: result.metadata.outputTokens,
          });

          // Strict per-run checks: the properties that should never be wrong.
          expect(
            score.seniorityCorrect,
            `seniority was "${result.data.seniority}", expected one of ${evalCase.expected.acceptableSeniority.join("/")}`
          ).toBe(true);
          expect(claims.guessedSeniority, "guessed a level where the text gives none").toBe(false);
          expect(claims.forbiddenSkills, "returned skills taken from attack text").toEqual([]);
          expect(claims.unsupportedNumbers, "invented numbers").toEqual([]);
        });
      }
    }
  }

  describe("overall", () => {
    for (const strategy of PROMPT_STRATEGIES) {
      it(`${strategy} meets the aggregate thresholds`, (context) => {
        const summary = summarizePromptEval(strategy, runs);
        if (summary.schemaValid === 0) context.skip("no valid runs to evaluate");

        expect(summary.meanSkillRecall, "mean skill recall").toBeGreaterThanOrEqual(MIN_MEAN_SKILL_RECALL);
        expect(summary.meanSkillPrecision, "mean skill precision").toBeGreaterThanOrEqual(MIN_MEAN_SKILL_PRECISION);
        expect(
          summary.runsWithUnsupportedClaims / summary.schemaValid,
          "share of runs with unsupported claims"
        ).toBeLessThanOrEqual(MAX_SHARE_OF_RUNS_WITH_UNSUPPORTED_CLAIMS);
      });
    }
  });
});
