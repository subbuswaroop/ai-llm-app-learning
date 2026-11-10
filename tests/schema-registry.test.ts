import { describe, expect, it } from "vitest";
import { z } from "zod";

import { JobAnalysisJsonSchema } from "../src/schemas/job-analysis.schema";
import {
  CURRENT_OUTPUT_SCHEMA_VERSION,
  getOutputSchema,
} from "../src/schemas/schema-registry";

const valid = {
  summary: "A role.",
  requiredSkills: ["React"],
  seniority: "mid",
  interviewTopics: ["React"],
};

describe("output schema versions", () => {
  it("the current version is 2.0.0", () => {
    expect(CURRENT_OUTPUT_SCHEMA_VERSION).toBe("2.0.0");
    expect(getOutputSchema().version).toBe("2.0.0");
  });

  it("the current registry entry matches the schema the application codes against", () => {
    expect(getOutputSchema().jsonSchema).toEqual(JobAnalysisJsonSchema);
  });

  it("1.0.0 rejects unknown seniority: that was not part of its contract", () => {
    const v1 = getOutputSchema("1.0.0").zod;

    expect(v1.safeParse({ ...valid, seniority: "unknown" }).success).toBe(false);
    for (const level of ["junior", "mid", "senior"]) {
      expect(v1.safeParse({ ...valid, seniority: level }).success).toBe(true);
    }
  });

  it("2.0.0 accepts unknown seniority", () => {
    const v2 = getOutputSchema("2.0.0").zod;

    for (const level of ["junior", "mid", "senior", "unknown"]) {
      expect(v2.safeParse({ ...valid, seniority: level }).success).toBe(true);
    }
  });

  it("only widens: everything valid under 1.0.0 is valid under 2.0.0", () => {
    const v1 = getOutputSchema("1.0.0").zod;
    const v2 = getOutputSchema("2.0.0").zod;

    for (const level of ["junior", "mid", "senior"]) {
      const output = { ...valid, seniority: level };
      expect(v1.safeParse(output).success).toBe(true);
      expect(v2.safeParse(output).success).toBe(true);
    }
  });

  it("generates each JSON Schema from its own Zod schema, so they cannot drift apart", () => {
    for (const version of ["1.0.0", "2.0.0"]) {
      const entry = getOutputSchema(version);
      expect(entry.jsonSchema).toEqual(z.toJSONSchema(entry.zod));
    }
  });

  it("rejects an unknown version and lists the known ones", () => {
    expect(() => getOutputSchema("9.9.9")).toThrow(RangeError);
    expect(() => getOutputSchema("9.9.9")).toThrow(/Known versions: 1\.0\.0, 2\.0\.0/);
  });
});

describe("released schemas are frozen", () => {
  // Full copies of what each released version sends to the model. Editing a
  // released schema in place changes what old results mean. Add a new version
  // instead of updating these.
  const common = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["summary", "requiredSkills", "seniority", "interviewTopics"],
    additionalProperties: false,
  };
  const summary = {
    type: "string",
    minLength: 1,
    description: "One or two sentence summary of the role",
  };
  const requiredSkills = {
    type: "array",
    items: { type: "string" },
    description: "Technical skills explicitly required by the job description",
  };
  const interviewTopics = {
    type: "array",
    items: { type: "string" },
    description: "Topics worth covering in an interview for this role",
  };

  it("schema 1.0.0", () => {
    expect(getOutputSchema("1.0.0").jsonSchema).toEqual({
      ...common,
      properties: {
        summary,
        requiredSkills,
        seniority: {
          type: "string",
          enum: ["junior", "mid", "senior"],
          description: "Seniority level the role is aimed at",
        },
        interviewTopics,
      },
    });
  });

  it("schema 2.0.0", () => {
    expect(getOutputSchema("2.0.0").jsonSchema).toEqual({
      ...common,
      properties: {
        summary,
        requiredSkills,
        seniority: {
          type: "string",
          enum: ["junior", "mid", "senior", "unknown"],
          description:
            'Seniority level the role is aimed at. Use "unknown" when the job description gives no clear evidence of the level. Do not guess.',
        },
        interviewTopics,
      },
    });
  });
});
