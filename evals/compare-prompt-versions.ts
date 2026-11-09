/**
 * Does prompt version 1.1.0 stop the model guessing a seniority level when
 * the job description gives no evidence? Runs the same two no-evidence cases
 * with version 1.0.0 (told to pick junior, mid or senior) and 1.1.0 (allowed
 * to answer "unknown"), both against the current schema.
 *
 *   npm run eval:versions
 *
 * Needs Ollama running. Not part of `npm test`.
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
import {
  JobAnalysisService,
  JobAnalysisValidationError,
} from "../src/services/job-analysis.service";
import { PROMPT_STRATEGIES } from "../src/types/prompt-strategy";
import { evaluateAnalysis } from "./prompt-eval";
import { promptEvalCases } from "./prompt-eval.cases";

const VERSIONS = ["1.0.0", "1.1.0"];
const CASE_IDS = ["missing-seniority", "very-sparse"];
const RUNS = 3;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Row {
  version: string;
  strategy: string;
  caseId: string;
  run: number;
  status: "ok" | "invalid" | "ollama_unavailable";
  seniority?: string;
  guessed?: boolean;
  skills?: string[];
}

async function main() {
  const rows: Row[] = [];

  for (let run = 0; run < RUNS; run++) {
    for (const caseId of CASE_IDS) {
      const evalCase = promptEvalCases.find((c) => c.id === caseId)!;

      for (const strategy of PROMPT_STRATEGIES) {
        for (const version of VERSIONS) {
          const service = new JobAnalysisService(
            new OllamaProvider({ promptVersion: version, timeoutMs: 180_000 })
          );
          const base = { version, strategy, caseId, run };
          let row: Row | undefined;

          for (let attempt = 1; attempt <= MAX_ATTEMPTS && !row; attempt++) {
            try {
              const { data } = await service.analyze(evalCase.jobDescription, { strategy });
              const { claims } = evaluateAnalysis(evalCase, data);
              row = { ...base, status: "ok", seniority: data.seniority, guessed: claims.guessedSeniority, skills: data.requiredSkills };
            } catch (error) {
              if (
                error instanceof JobAnalysisValidationError ||
                error instanceof LlmInvalidJsonError ||
                error instanceof LlmOutputTruncatedError
              ) {
                row = { ...base, status: "invalid" };
              } else if (error instanceof LlmProviderError || error instanceof LlmTimeoutError) {
                if (attempt === MAX_ATTEMPTS) row = { ...base, status: "ollama_unavailable" };
                else await sleep(8_000);
              } else {
                throw error;
              }
            }
          }

          rows.push(row!);
          console.log(
            `${version} ${strategy.padEnd(9)} ${caseId.padEnd(18)} run ${run}: ${row!.status} ${row!.seniority ?? ""} ${row!.guessed ? "(GUESSED)" : ""}`
          );
        }
      }
    }
  }

  console.log("\nGuessed a level where the text gives none (of answered runs):");
  console.table(
    VERSIONS.flatMap((version) =>
      PROMPT_STRATEGIES.map((strategy) => {
        const answered = rows.filter((r) => r.version === version && r.strategy === strategy && r.status === "ok");
        return {
          version,
          strategy,
          answered: answered.length,
          guessed: answered.filter((r) => r.guessed).length,
          said_unknown: answered.filter((r) => r.seniority === "unknown").length,
          levels_chosen: [...new Set(answered.map((r) => r.seniority))].join(", "),
        };
      })
    )
  );

  const outDir = join(process.cwd(), "evals", "results");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "prompt-versions-latest.json");
  writeFileSync(file, JSON.stringify({ finishedAt: new Date().toISOString(), runs: RUNS, cases: CASE_IDS, rows }, null, 2));
  console.log(`Saved ${rows.length} runs to ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
