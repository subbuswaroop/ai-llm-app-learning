import type { JobAnalysis, SeniorityLevel } from "../src/schemas/job-analysis.schema";

/** Ground truth for one job description. Labels are human judgment, see cases file. */
export interface ExpectedAnalysis {
  /** Any of these seniority values counts as correct (several for genuinely ambiguous roles). */
  acceptableSeniority: readonly SeniorityLevel[];
  /** Skills the job description clearly requires. Recall is measured against these. */
  requiredSkills: readonly string[];
  /** Other skills that are reasonable to return (not penalised in precision). */
  acceptableExtraSkills?: readonly string[];
  /** Skills that must NOT appear: not in the job description (traps). */
  forbiddenSkills?: readonly string[];
}

export interface RunScore {
  seniorityCorrect: boolean;
  /** Fraction of expected required skills that were returned. */
  recall: number;
  /** Fraction of returned skills that are expected or acceptable. */
  precision: number;
  matchedRequired: string[];
  missingRequired: string[];
  unexpectedSkills: string[];
  forbiddenHits: string[];
}

// Words that mean the same thing for skill matching purposes.
const ALIASES: Record<string, string> = {
  reactjs: "react",
  nextjs: "next",
  nodejs: "node",
  vuejs: "vue",
  postgres: "postgresql",
  k8s: "kubernetes",
  ts: "typescript",
  restful: "rest",
  apis: "api",
  prototypes: "prototype",
  prototyping: "prototype",
};

/**
 * Splits a skill into comparable lowercase tokens.
 * "Next.js" -> ["next"], "RESTful APIs" -> ["rest", "api"], "C++" -> ["c++"].
 */
export function skillTokens(skill: string): string[] {
  return skill
    .toLowerCase()
    .replace(/\.js\b/g, "js")
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean)
    .map((token) => ALIASES[token] ?? token);
}

/**
 * True when every word of `expected` appears in `actual`.
 * Whole-word matching, so "Java" does not match "JavaScript" and "SQL"
 * does not match "PostgreSQL", while "Spark" matches "Apache Spark".
 */
export function skillMatches(expected: string, actual: string): boolean {
  const expectedTokens = skillTokens(expected);
  if (expectedTokens.length === 0) return false;
  const actualTokens = new Set(skillTokens(actual));
  return expectedTokens.every((token) => actualTokens.has(token));
}

const matchesAny = (candidates: readonly string[], actual: string) =>
  candidates.some((candidate) => skillMatches(candidate, actual));

export function scoreAnalysis(
  analysis: JobAnalysis,
  expected: ExpectedAnalysis
): RunScore {
  const returned = analysis.requiredSkills;
  const allowed = [...expected.requiredSkills, ...(expected.acceptableExtraSkills ?? [])];

  const matchedRequired = expected.requiredSkills.filter((skill) =>
    returned.some((actual) => skillMatches(skill, actual))
  );
  const missingRequired = expected.requiredSkills.filter(
    (skill) => !matchedRequired.includes(skill)
  );
  const unexpectedSkills = returned.filter((actual) => !matchesAny(allowed, actual));
  const forbiddenHits = returned.filter((actual) =>
    matchesAny(expected.forbiddenSkills ?? [], actual)
  );

  const recall =
    expected.requiredSkills.length === 0
      ? 1
      : matchedRequired.length / expected.requiredSkills.length;

  const precision =
    returned.length === 0
      ? expected.requiredSkills.length === 0
        ? 1
        : 0
      : (returned.length - unexpectedSkills.length) / returned.length;

  return {
    seniorityCorrect: expected.acceptableSeniority.includes(analysis.seniority),
    recall,
    precision,
    matchedRequired,
    missingRequired,
    unexpectedSkills,
    forbiddenHits,
  };
}

export const mean = (values: readonly number[]): number =>
  values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length;

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export type RunStatus =
  | "ok"
  | "invalid_json"
  | "invalid_schema"
  | "truncated"
  | "infra_error";

export interface RunRecord {
  strategy: string;
  caseId: string;
  run: number;
  status: RunStatus;
  score?: RunScore;
  model?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  analysis?: JobAnalysis;
  error?: string;
}

export interface StrategySummary {
  strategy: string;
  /** Runs where the model answered (everything except infrastructure errors). */
  answered: number;
  infraErrors: number;
  /** Runs that produced a schema-valid analysis. */
  valid: number;
  seniorityCorrect: number;
  meanRecall: number;
  meanPrecision: number;
  /** Runs that returned at least one forbidden skill. */
  runsWithForbiddenSkills: number;
  runsWithMissingRequired: number;
  meanDurationMs: number;
  medianDurationMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
}

/** Aggregates one strategy's runs. Infrastructure errors are excluded from accuracy. */
export function summarize(strategy: string, records: readonly RunRecord[]): StrategySummary {
  const mine = records.filter((r) => r.strategy === strategy);
  const answered = mine.filter((r) => r.status !== "infra_error");
  const scored = answered.filter((r) => r.status === "ok" && r.score);

  return {
    strategy,
    answered: answered.length,
    infraErrors: mine.length - answered.length,
    valid: scored.length,
    seniorityCorrect: scored.filter((r) => r.score!.seniorityCorrect).length,
    meanRecall: mean(scored.map((r) => r.score!.recall)),
    meanPrecision: mean(scored.map((r) => r.score!.precision)),
    runsWithForbiddenSkills: scored.filter((r) => r.score!.forbiddenHits.length > 0).length,
    runsWithMissingRequired: scored.filter((r) => r.score!.missingRequired.length > 0).length,
    meanDurationMs: mean(scored.map((r) => r.durationMs!)),
    medianDurationMs: median(scored.map((r) => r.durationMs!)),
    meanInputTokens: mean(scored.map((r) => r.inputTokens!)),
    meanOutputTokens: mean(scored.map((r) => r.outputTokens!)),
  };
}
