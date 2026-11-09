import { describe, expect, it } from "vitest";

import { evalCases } from "../evals/job-analysis.cases";
import {
  mean,
  median,
  scoreAnalysis,
  skillMatches,
  skillTokens,
  summarize,
  type ExpectedAnalysis,
  type RunRecord,
} from "../evals/scoring";
import { jobAnalysisExamples } from "../src/prompts/job-analysis.examples";
import type { JobAnalysis } from "../src/schemas/job-analysis.schema";

const analysis = (overrides: Partial<JobAnalysis> = {}): JobAnalysis => ({
  summary: "s",
  requiredSkills: [],
  seniority: "mid",
  interviewTopics: [],
  ...overrides,
});

describe("skill matching", () => {
  it("normalizes common spellings", () => {
    expect(skillTokens("Next.js")).toEqual(["next"]);
    expect(skillTokens("NextJS")).toEqual(["next"]);
    expect(skillTokens("React.js")).toEqual(["react"]);
    expect(skillTokens("RESTful APIs")).toEqual(["rest", "api"]);
    expect(skillTokens("C++")).toEqual(["c++"]);
  });

  it.each([
    ["React", "React.js"],
    ["Next.js", "NextJS"],
    ["Node.js", "Node"],
    ["Spark", "Apache Spark"],
    ["PostgreSQL", "Postgres"],
    ["REST APIs", "RESTful API design"],
    ["Kubernetes", "K8s"],
    ["prototyping", "Prototypes"],
  ])("treats %j and %j as the same skill", (expected, actual) => {
    expect(skillMatches(expected, actual)).toBe(true);
  });

  it.each([
    ["Java", "JavaScript"],
    ["SQL", "PostgreSQL"],
    ["SQL", "MySQL"],
    ["Go", "Django"],
    ["Python", "Jython"],
    ["Angular", "React"],
  ] as const)("does not confuse %j with %j", (expected, actual) => {
    expect(skillMatches(expected, actual)).toBe(false);
  });

  it("requires every word of a multi-word skill", () => {
    expect(skillMatches("user research", "User Research")).toBe(true);
    expect(skillMatches("user research", "research")).toBe(false);
  });

  it("never matches an empty expected skill", () => {
    expect(skillMatches("", "anything")).toBe(false);
    expect(skillMatches("...", "anything")).toBe(false);
  });
});

describe("scoreAnalysis", () => {
  const expected: ExpectedAnalysis = {
    acceptableSeniority: ["junior", "mid"],
    requiredSkills: ["Java", "Spring Boot", "MySQL"],
    acceptableExtraSkills: ["backend development"],
    forbiddenSkills: ["Kubernetes"],
  };

  it("scores a perfect answer", () => {
    const score = scoreAnalysis(
      analysis({ requiredSkills: ["Java", "Spring Boot", "MySQL"], seniority: "mid" }),
      expected,
    );

    expect(score).toMatchObject({
      seniorityCorrect: true,
      recall: 1,
      precision: 1,
      missingRequired: [],
      unexpectedSkills: [],
      forbiddenHits: [],
    });
  });

  it("accepts any of several acceptable seniority values", () => {
    expect(scoreAnalysis(analysis({ seniority: "junior" }), expected).seniorityCorrect).toBe(true);
    expect(scoreAnalysis(analysis({ seniority: "senior" }), expected).seniorityCorrect).toBe(false);
  });

  it("measures recall against required skills", () => {
    const score = scoreAnalysis(analysis({ requiredSkills: ["Java"] }), expected);

    expect(score.recall).toBeCloseTo(1 / 3);
    expect(score.missingRequired).toEqual(["Spring Boot", "MySQL"]);
  });

  it("does not count acceptable extra skills against precision", () => {
    const score = scoreAnalysis(
      analysis({ requiredSkills: ["Java", "Backend Development"] }),
      expected,
    );

    expect(score.precision).toBe(1);
  });

  it("counts invented skills against precision", () => {
    const score = scoreAnalysis(
      analysis({ requiredSkills: ["Java", "Rust", "Haskell", "Erlang"] }),
      expected,
    );

    expect(score.precision).toBe(0.25);
    expect(score.unexpectedSkills).toEqual(["Rust", "Haskell", "Erlang"]);
  });

  it("flags forbidden skills", () => {
    const score = scoreAnalysis(
      analysis({ requiredSkills: ["Java", "Kubernetes"] }),
      expected,
    );

    expect(score.forbiddenHits).toEqual(["Kubernetes"]);
  });

  it("scores precision 0 when nothing is returned but skills were expected", () => {
    expect(scoreAnalysis(analysis({ requiredSkills: [] }), expected).precision).toBe(0);
  });
});

describe("summarize", () => {
  const ok = (
    strategy: string,
    durationMs: number,
    seniorityCorrect: boolean,
    forbidden: string[] = [],
  ): RunRecord => ({
    strategy,
    caseId: "c",
    run: 0,
    status: "ok",
    durationMs,
    inputTokens: 100,
    outputTokens: 50,
    score: {
      seniorityCorrect,
      recall: 1,
      precision: 1,
      matchedRequired: [],
      missingRequired: [],
      unexpectedSkills: [],
      forbiddenHits: forbidden,
    },
  });

  it("aggregates only the requested strategy", () => {
    const records = [ok("a", 1000, true), ok("a", 3000, false), ok("b", 9000, true)];

    const summary = summarize("a", records);

    expect(summary.answered).toBe(2);
    expect(summary.seniorityCorrect).toBe(1);
    expect(summary.meanDurationMs).toBe(2000);
    expect(summary.meanInputTokens).toBe(100);
  });

  it("excludes infrastructure errors from accuracy but reports them", () => {
    const records: RunRecord[] = [
      ok("a", 1000, true),
      { strategy: "a", caseId: "c", run: 1, status: "infra_error", error: "OOM" },
    ];

    const summary = summarize("a", records);

    expect(summary.infraErrors).toBe(1);
    expect(summary.answered).toBe(1);
    expect(summary.valid).toBe(1);
  });

  it("counts invalid model output as answered but not valid", () => {
    const records: RunRecord[] = [
      ok("a", 1000, true),
      { strategy: "a", caseId: "c", run: 1, status: "invalid_schema" },
    ];

    const summary = summarize("a", records);

    expect(summary.answered).toBe(2);
    expect(summary.valid).toBe(1);
  });

  it("counts runs that returned a forbidden skill", () => {
    const records = [ok("a", 1, true, ["Kubernetes"]), ok("a", 1, true)];

    expect(summarize("a", records).runsWithForbiddenSkills).toBe(1);
  });

  it("computes mean and median", () => {
    expect(mean([1, 2, 3, 10])).toBe(4);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe("eval cases", () => {
  it("have unique ids", () => {
    const ids = evalCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("do not reuse a few-shot example's job description", () => {
    const exampleTexts = new Set(jobAnalysisExamples.map((e) => e.jobDescription.trim()));

    for (const evalCase of evalCases) {
      expect(exampleTexts.has(evalCase.jobDescription.trim())).toBe(false);
    }
  });

  it("only forbid skills that are absent from the job description itself", () => {
    // A forbidden skill that the job description really mentions would make
    // returning it correct, so the trap would be unfair.
    for (const evalCase of evalCases) {
      const text = skillTokens(evalCase.jobDescription);
      for (const forbidden of evalCase.expected.forbiddenSkills ?? []) {
        const inInjectionText = evalCase.id === "injection-trap";
        const mentioned = skillTokens(forbidden).every((t) => text.includes(t));
        // The injection case names the skills on purpose; the model must not obey it.
        expect(mentioned && !inInjectionText).toBe(false);
      }
    }
  });

  it("require only skills that the job description actually mentions", () => {
    for (const evalCase of evalCases) {
      const text = skillTokens(evalCase.jobDescription);
      for (const skill of evalCase.expected.requiredSkills) {
        expect(skillTokens(skill).every((t) => text.includes(t)), `${evalCase.id}: ${skill}`).toBe(true);
      }
    }
  });
});
