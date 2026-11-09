import { describe, expect, it } from "vitest";

import {
  JobAnalysisJsonSchema,
  JobAnalysisSchema,
  SeniorityLevelSchema,
} from "../src/schemas/job-analysis.schema";

const valid = {
  summary: "A role.",
  requiredSkills: ["React"],
  seniority: "mid",
  interviewTopics: ["React"],
};

describe("seniority", () => {
  it.each(["junior", "mid", "senior", "unknown"])("accepts %j", (level) => {
    expect(SeniorityLevelSchema.safeParse(level).success).toBe(true);
    expect(JobAnalysisSchema.safeParse({ ...valid, seniority: level }).success).toBe(true);
  });

  it.each(["principal", "lead", "Unknown", "UNKNOWN", "", " unknown", "n/a", null, undefined, 3])(
    "rejects %j",
    (level) => {
      expect(JobAnalysisSchema.safeParse({ ...valid, seniority: level }).success).toBe(false);
    },
  );

  it("is still required: leaving it out is not the same as 'unknown'", () => {
    const { seniority: _omitted, ...withoutSeniority } = valid;

    expect(JobAnalysisSchema.safeParse(withoutSeniority).success).toBe(false);
  });
});

describe("an analysis with insufficient evidence", () => {
  it("is valid with unknown seniority and no skills", () => {
    const result = JobAnalysisSchema.safeParse({
      summary: "Developer role. The posting gives few details.",
      requiredSkills: [],
      seniority: "unknown",
      interviewTopics: [],
    });

    expect(result.success).toBe(true);
  });
});

describe("the JSON Schema sent to the model", () => {
  const properties = (JobAnalysisJsonSchema as { properties: Record<string, any> }).properties;

  it("lets the model answer unknown", () => {
    expect(properties.seniority.enum).toEqual(["junior", "mid", "senior", "unknown"]);
  });

  it("tells the model not to guess", () => {
    expect(properties.seniority.description).toMatch(/unknown/);
    expect(properties.seniority.description).toMatch(/do not guess/i);
  });

  it("still requires every field", () => {
    expect((JobAnalysisJsonSchema as { required: string[] }).required.sort()).toEqual([
      "interviewTopics",
      "requiredSkills",
      "seniority",
      "summary",
    ]);
  });
});
