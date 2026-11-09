import { describe, expect, it } from "vitest";

import {
  findUnsupportedClaims,
  findUnsupportedNumbers,
  isGrounded,
  stem,
} from "../evals/claims";
import {
  evaluateAnalysis,
  summarizePromptEval,
  toMarkdown,
  type PromptEvalRun,
} from "../evals/prompt-eval";
import { promptEvalCases } from "../evals/prompt-eval.cases";
import {
  jobAnalysisExamples,
  jobAnalysisExamplesWithUnknown,
} from "../src/prompts/job-analysis.examples";
import type { JobAnalysis } from "../src/schemas/job-analysis.schema";

const analysis = (overrides: Partial<JobAnalysis> = {}): JobAnalysis => ({
  summary: "A role.",
  requiredSkills: [],
  seniority: "mid",
  interviewTopics: [],
  ...overrides,
});

const byId = (id: string) => promptEvalCases.find((c) => c.id === id)!;

describe("stemming", () => {
  it.each([
    ["optimizing", "optimization"],
    ["optimize", "optimization"],
    ["testing", "tests"],
    ["building", "build"],
    ["development", "developer"],
  ])("treats %j and %j as the same word", (a, b) => {
    expect(stem(a)).toBe(stem(b));
  });

  it("leaves short words alone", () => {
    expect(stem("css")).toBe("css");
    expect(stem("aws")).toBe("aws");
    expect(stem("sql")).toBe("sql");
  });
});

describe("isGrounded", () => {
  const text = "You will own performance, optimizing application speed. Experience with Docker.";

  it("accepts a skill whose words appear in the text, in any form", () => {
    expect(isGrounded("Application Performance Optimization", text)).toBe(true);
    expect(isGrounded("Docker", text)).toBe(true);
  });

  it("rejects a skill the text never mentions", () => {
    expect(isGrounded("Kubernetes", text)).toBe(false);
  });

  it("requires every word of a multi-word skill", () => {
    expect(isGrounded("Docker Swarm", text)).toBe(false);
  });
});

describe("findUnsupportedNumbers", () => {
  it("flags a number the job description never states", () => {
    expect(findUnsupportedNumbers("Needs 5 years of React", "Looking for a React developer")).toEqual(["5"]);
  });

  it("ignores numbers that the job description does state", () => {
    expect(findUnsupportedNumbers("Needs 8 years of React", "8+ years of experience")).toEqual([]);
  });

  it("lists each unsupported number once", () => {
    expect(findUnsupportedNumbers("3 teams and 3 services and 4 apps", "nothing")).toEqual(["3", "4"]);
  });
});

describe("findUnsupportedClaims", () => {
  const missingSeniority = byId("missing-seniority");

  it("counts nothing for a faithful answer", () => {
    const claims = findUnsupportedClaims(
      analysis({ seniority: "unknown", requiredSkills: ["React", "Node.js"] }),
      missingSeniority.expected,
      missingSeniority.jobDescription,
    );

    expect(claims.total).toBe(0);
    expect(claims.overAbstained).toBe(false);
  });

  it("counts a guessed seniority when the text gives no evidence", () => {
    const claims = findUnsupportedClaims(
      analysis({ seniority: "mid", requiredSkills: ["React", "Node.js"] }),
      missingSeniority.expected,
      missingSeniority.jobDescription,
    );

    expect(claims.guessedSeniority).toBe(true);
    expect(claims.total).toBe(1);
  });

  it("does not count unknown as a guess", () => {
    const claims = findUnsupportedClaims(
      analysis({ seniority: "unknown" }),
      missingSeniority.expected,
      missingSeniority.jobDescription,
    );

    expect(claims.guessedSeniority).toBe(false);
  });

  it("flags over-abstaining separately, without counting it as a claim", () => {
    const senior = byId("senior-react");

    const claims = findUnsupportedClaims(
      analysis({ seniority: "unknown", requiredSkills: ["React"] }),
      senior.expected,
      senior.jobDescription,
    );

    expect(claims.overAbstained).toBe(true);
    expect(claims.total).toBe(0);
  });

  it("counts a skill that is neither labelled nor in the job description", () => {
    const claims = findUnsupportedClaims(
      analysis({ seniority: "unknown", requiredSkills: ["React", "Kubernetes"] }),
      missingSeniority.expected,
      missingSeniority.jobDescription,
    );

    expect(claims.ungroundedSkills).toEqual(["Kubernetes"]);
  });

  it("does not count a labelled extra skill as unsupported", () => {
    const claims = findUnsupportedClaims(
      analysis({ seniority: "unknown", requiredSkills: ["React", "Web Development"] }),
      missingSeniority.expected,
      missingSeniority.jobDescription,
    );

    expect(claims.ungroundedSkills).toEqual([]);
  });

  it("counts a number invented in the summary", () => {
    const claims = findUnsupportedClaims(
      analysis({ seniority: "unknown", summary: "Developer with 5 years of experience" }),
      missingSeniority.expected,
      missingSeniority.jobDescription,
    );

    expect(claims.unsupportedNumbers).toEqual(["5"]);
  });

  it("counts skills taken from the attack text, even though the text mentions them", () => {
    const malicious = byId("malicious-instructions");

    const claims = findUnsupportedClaims(
      analysis({ seniority: "senior", requiredSkills: ["React", "System Prompt", "Environment Variables"] }),
      malicious.expected,
      malicious.jobDescription,
    );

    expect(claims.forbiddenSkills).toEqual(["System Prompt", "Environment Variables"]);
    expect(claims.total).toBe(2);
  });
});

describe("evaluateAnalysis", () => {
  it("scores a perfect answer for the senior case", () => {
    const { score, claims } = evaluateAnalysis(
      byId("senior-react"),
      analysis({
        seniority: "senior",
        summary: "Senior React developer leading frontend architecture.",
        requiredSkills: ["React", "TypeScript", "Redux", "GraphQL"],
      }),
    );

    expect(score).toMatchObject({ seniorityCorrect: true, recall: 1, precision: 1 });
    expect(claims.total).toBe(0);
  });

  it("does not treat the word 'senior' in the junior posting as a reason for senior", () => {
    const { score } = evaluateAnalysis(
      byId("junior-frontend"),
      analysis({ seniority: "senior", requiredSkills: ["HTML", "CSS", "JavaScript"] }),
    );

    expect(score.seniorityCorrect).toBe(false);
  });
});

describe("summarizePromptEval and toMarkdown", () => {
  const run = (overrides: Partial<PromptEvalRun> & { total?: number; correct?: boolean }): PromptEvalRun => {
    const { total = 0, correct = true, ...rest } = overrides;
    return {
      caseId: "senior-react",
      strategy: "few-shot",
      run: 0,
      schemaValid: true,
      score: {
        seniorityCorrect: correct,
        recall: 1,
        precision: 1,
        matchedRequired: [],
        missingRequired: [],
        unexpectedSkills: [],
        forbiddenHits: [],
      },
      claims: {
        ungroundedSkills: [],
        forbiddenSkills: [],
        unsupportedNumbers: [],
        guessedSeniority: false,
        total,
        overAbstained: false,
      },
      ...rest,
    };
  };

  it("counts schema validity, seniority accuracy and unsupported claims", () => {
    const runs = [
      run({}),
      run({ correct: false, total: 2 }),
      { caseId: "senior-react", strategy: "few-shot" as const, run: 2, schemaValid: false },
    ];

    const summary = summarizePromptEval("few-shot", runs);

    expect(summary).toMatchObject({
      runs: 3,
      schemaValid: 2,
      seniorityCorrect: 1,
      runsWithUnsupportedClaims: 1,
      unsupportedClaims: 2,
    });
  });

  it("only summarizes the requested strategy", () => {
    const runs = [run({}), run({ strategy: "zero-shot" })];

    expect(summarizePromptEval("few-shot", runs).runs).toBe(1);
  });

  it("produces a report with one row per case", () => {
    const markdown = toMarkdown("9.9.9", promptEvalCases, [run({})], ["few-shot"]);

    expect(markdown).toContain("Prompt version 9.9.9");
    for (const evalCase of promptEvalCases) {
      expect(markdown).toContain(`| ${evalCase.id} |`);
    }
  });
});

describe("evaluation cases", () => {
  it("include the five required kinds of case", () => {
    const ids = promptEvalCases.map((c) => c.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "junior-frontend",
        "mid-fullstack",
        "senior-react",
        "missing-seniority",
        "malicious-instructions",
      ]),
    );
    expect(promptEvalCases.length).toBeGreaterThanOrEqual(5);
  });

  it("have unique ids", () => {
    const ids = promptEvalCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never reuse a few-shot example's job description", () => {
    const exampleTexts = new Set(
      [...jobAnalysisExamples, ...jobAnalysisExamplesWithUnknown].map((e) => e.jobDescription.trim()),
    );

    for (const evalCase of promptEvalCases) {
      expect(exampleTexts.has(evalCase.jobDescription.trim()), evalCase.id).toBe(false);
    }
  });

  it("only require skills that the job description actually mentions", () => {
    for (const evalCase of promptEvalCases) {
      for (const skill of evalCase.expected.requiredSkills) {
        expect(isGrounded(skill, evalCase.jobDescription), `${evalCase.id}: ${skill}`).toBe(true);
      }
    }
  });

  it("expect unknown exactly where the text gives no evidence of a level", () => {
    expect(byId("missing-seniority").expected.acceptableSeniority).toEqual(["unknown"]);
    expect(byId("very-sparse").expected.acceptableSeniority).toEqual(["unknown"]);
  });

  it("never accept unknown where the level is stated", () => {
    for (const id of ["junior-frontend", "mid-fullstack", "senior-react", "malicious-instructions", "ambiguous-2-4-years"]) {
      expect(byId(id).expected.acceptableSeniority, id).not.toContain("unknown");
    }
  });
});
