import type { JobAnalysis } from "../src/schemas/job-analysis.schema";
import { skillMatches, skillTokens, type ExpectedAnalysis } from "./scoring";

/**
 * Unsupported claims: things in an answer that the job description does not
 * back up. These are heuristics and can be wrong in both directions, so treat
 * the counts as a signal to read the answers, not as a verdict.
 */

// Word endings removed so that "optimizing" and "optimization" compare equal.
// Deliberately crude: it is applied to both sides, so it only has to be
// consistent, not linguistically correct.
const SUFFIXES = [
  "ization", "ations", "ation", "izing", "ising", "ings", "ing", "ments",
  "ment", "ions", "ion", "ize", "ise", "ers", "er", "ed", "es", "s",
];

export function stem(token: string): string {
  for (const suffix of SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

const stems = (text: string): string[] => skillTokens(text).map(stem);

/** True when every word of the skill appears (after stemming) in the source text. */
export function isGrounded(skill: string, sourceText: string): boolean {
  const skillStems = stems(skill);
  if (skillStems.length === 0) return false;
  const sourceStems = new Set(stems(sourceText));
  return skillStems.every((s) => sourceStems.has(s));
}

/** Numbers that appear in `claimText` but not in `sourceText`. */
export function findUnsupportedNumbers(claimText: string, sourceText: string): string[] {
  const inSource = new Set(sourceText.match(/\d+/g) ?? []);
  return [...new Set(claimText.match(/\d+/g) ?? [])].filter((n) => !inSource.has(n));
}

export interface UnsupportedClaims {
  /** Returned skills that are not in the labelled lists and not in the job description. */
  ungroundedSkills: string[];
  /** Returned skills taken from the attack text or the company context. */
  forbiddenSkills: string[];
  /** Numbers in the summary or topics that the job description never mentions. */
  unsupportedNumbers: string[];
  /** The case has no evidence of a level, but the model picked one anyway. */
  guessedSeniority: boolean;
  /** Count of everything above. */
  total: number;
  /** Not a claim: the model said "unknown" although the level is clear. Tracked separately. */
  overAbstained: boolean;
}

export function findUnsupportedClaims(
  analysis: JobAnalysis,
  expected: ExpectedAnalysis,
  jobDescription: string
): UnsupportedClaims {
  const labelled = [...expected.requiredSkills, ...(expected.acceptableExtraSkills ?? [])];

  const forbiddenSkills = analysis.requiredSkills.filter((actual) =>
    (expected.forbiddenSkills ?? []).some((f) => skillMatches(f, actual))
  );
  const ungroundedSkills = analysis.requiredSkills.filter(
    (actual) =>
      !forbiddenSkills.includes(actual) &&
      !labelled.some((l) => skillMatches(l, actual)) &&
      !isGrounded(actual, jobDescription)
  );
  const unsupportedNumbers = findUnsupportedNumbers(
    [analysis.summary, ...analysis.interviewTopics].join(" "),
    jobDescription
  );

  const expectsUnknownOnly =
    expected.acceptableSeniority.length === 1 && expected.acceptableSeniority[0] === "unknown";
  const guessedSeniority = expectsUnknownOnly && analysis.seniority !== "unknown";
  const overAbstained =
    analysis.seniority === "unknown" && !expected.acceptableSeniority.includes("unknown");

  return {
    ungroundedSkills,
    forbiddenSkills,
    unsupportedNumbers,
    guessedSeniority,
    total:
      ungroundedSkills.length +
      forbiddenSkills.length +
      unsupportedNumbers.length +
      (guessedSeniority ? 1 : 0),
    overAbstained,
  };
}
