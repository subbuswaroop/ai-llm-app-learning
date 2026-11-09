import type { JobAnalysis } from "../src/schemas/job-analysis.schema";
import type { PromptStrategy } from "../src/types/prompt-strategy";
import { findUnsupportedClaims, type UnsupportedClaims } from "./claims";
import type { PromptEvalCase } from "./prompt-eval.cases";
import { mean, scoreAnalysis, type RunScore } from "./scoring";

/** One model call that produced an answer (Ollama failures are not recorded). */
export interface PromptEvalRun {
  caseId: string;
  strategy: PromptStrategy;
  run: number;
  /** False when the response was not valid JSON or did not match the schema. */
  schemaValid: boolean;
  analysis?: JobAnalysis;
  score?: RunScore;
  claims?: UnsupportedClaims;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export function evaluateAnalysis(evalCase: PromptEvalCase, analysis: JobAnalysis) {
  return {
    score: scoreAnalysis(analysis, evalCase.expected),
    claims: findUnsupportedClaims(analysis, evalCase.expected, evalCase.jobDescription),
  };
}

export interface PromptEvalSummary {
  strategy: PromptStrategy;
  runs: number;
  schemaValid: number;
  /** Seniority metrics are over schema-valid runs. */
  seniorityCorrect: number;
  meanSkillPrecision: number;
  meanSkillRecall: number;
  /** Runs with at least one unsupported claim. */
  runsWithUnsupportedClaims: number;
  unsupportedClaims: number;
  guessedSeniority: number;
  overAbstained: number;
}

export function summarizePromptEval(
  strategy: PromptStrategy,
  runs: readonly PromptEvalRun[]
): PromptEvalSummary {
  const mine = runs.filter((r) => r.strategy === strategy);
  const valid = mine.filter((r) => r.schemaValid && r.score && r.claims);

  return {
    strategy,
    runs: mine.length,
    schemaValid: valid.length,
    seniorityCorrect: valid.filter((r) => r.score!.seniorityCorrect).length,
    meanSkillPrecision: mean(valid.map((r) => r.score!.precision)),
    meanSkillRecall: mean(valid.map((r) => r.score!.recall)),
    runsWithUnsupportedClaims: valid.filter((r) => r.claims!.total > 0).length,
    unsupportedClaims: valid.reduce((sum, r) => sum + r.claims!.total, 0),
    guessedSeniority: valid.filter((r) => r.claims!.guessedSeniority).length,
    overAbstained: valid.filter((r) => r.claims!.overAbstained).length,
  };
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${n}/${d}`);
const num = (n: number) => (Number.isNaN(n) ? "n/a" : n.toFixed(2));

/** A readable report: overall table per strategy, then one row per case. */
export function toMarkdown(
  promptVersion: string,
  cases: readonly PromptEvalCase[],
  runs: readonly PromptEvalRun[],
  strategies: readonly PromptStrategy[]
): string {
  const lines: string[] = [`Prompt version ${promptVersion}`, ""];

  lines.push(
    "| Strategy | Runs | Schema valid | Seniority correct | Skill precision | Skill recall | Runs with unsupported claims | Guessed seniority | Over-abstained |",
    "|---|---|---|---|---|---|---|---|---|"
  );
  for (const strategy of strategies) {
    const s = summarizePromptEval(strategy, runs);
    lines.push(
      `| ${strategy} | ${s.runs} | ${pct(s.schemaValid, s.runs)} | ${pct(s.seniorityCorrect, s.schemaValid)} | ` +
        `${num(s.meanSkillPrecision)} | ${num(s.meanSkillRecall)} | ${pct(s.runsWithUnsupportedClaims, s.schemaValid)} | ` +
        `${s.guessedSeniority} | ${s.overAbstained} |`
    );
  }

  lines.push("", "Per case (seniority correct, mean recall, runs with unsupported claims):", "");
  lines.push(`| Case | ${strategies.join(" | ")} |`, `|---|${strategies.map(() => "---").join("|")}|`);
  for (const evalCase of cases) {
    const cells = strategies.map((strategy) => {
      const mine = runs.filter((r) => r.caseId === evalCase.id && r.strategy === strategy && r.schemaValid);
      if (mine.length === 0) return "no valid runs";
      return (
        `sen ${mine.filter((r) => r.score!.seniorityCorrect).length}/${mine.length}, ` +
        `recall ${num(mean(mine.map((r) => r.score!.recall)))}, ` +
        `unsupported ${mine.filter((r) => r.claims!.total > 0).length}`
      );
    });
    lines.push(`| ${evalCase.id} | ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}
