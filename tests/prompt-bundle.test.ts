import { describe, expect, it } from "vitest";

import {
  jobAnalysisExamples,
  jobAnalysisExamplesWithUnknown,
  unknownSeniorityExample,
} from "../src/prompts/job-analysis.examples";
import {
  JOB_ANALYSIS_SYSTEM_PROMPT_V1,
  JOB_ANALYSIS_SYSTEM_PROMPT_V1_1,
} from "../src/prompts/job-analysis.prompt";
import { createPromptBundle, fingerprintBundle } from "../src/prompts/prompt-bundle";
import {
  CURRENT_PROMPT_BUNDLE_VERSION,
  getPromptBundle,
  listPromptBundleVersions,
} from "../src/prompts/prompt-registry";
import { getOutputSchema } from "../src/schemas/schema-registry";

const enumOf = (bundle: ReturnType<typeof getPromptBundle>) =>
  (bundle.outputJsonSchema as { properties: { seniority: { enum: string[] } } }).properties
    .seniority.enum;

describe("a bundle keeps prompt, examples and output contract together", () => {
  const bundle = getPromptBundle("1.1.0");

  it("has every part", () => {
    expect(bundle.version).toBe("1.1.0");
    expect(bundle.schemaVersion).toBe("2.0.0");
    expect(bundle.systemPrompt).toBe(JOB_ANALYSIS_SYSTEM_PROMPT_V1_1);
    expect(bundle.examples).toBe(jobAnalysisExamplesWithUnknown);
    expect(typeof bundle.outputSchema.safeParse).toBe("function");
    expect(bundle.outputJsonSchema).toBeTypeOf("object");
    expect(typeof bundle.buildMessages).toBe("function");
  });

  it("takes its JSON Schema from its own schema version", () => {
    expect(bundle.outputJsonSchema).toEqual(getOutputSchema(bundle.schemaVersion).jsonSchema);
  });

  it("validates with its own schema version", () => {
    expect(bundle.outputSchema).toBe(getOutputSchema(bundle.schemaVersion).zod);
  });

  it("the current version resolves to the current bundle", () => {
    expect(getPromptBundle().version).toBe(CURRENT_PROMPT_BUNDLE_VERSION);
    expect(CURRENT_PROMPT_BUNDLE_VERSION).toBe("1.1.0");
  });
});

describe("old and new bundles keep their own contracts", () => {
  it("1.0.0 uses the original three-level contract", () => {
    const bundle = getPromptBundle("1.0.0");

    expect(bundle.schemaVersion).toBe("1.0.0");
    expect(enumOf(bundle)).toEqual(["junior", "mid", "senior"]);
    expect(bundle.systemPrompt).toBe(JOB_ANALYSIS_SYSTEM_PROMPT_V1);
  });

  it("1.1.0 uses the four-level contract", () => {
    expect(enumOf(getPromptBundle("1.1.0"))).toEqual(["junior", "mid", "senior", "unknown"]);
  });

  it("the JSON Schema a model sees depends on the bundle, not on a global", () => {
    // The point of bundling: an old prompt must not be handed a newer contract.
    expect(enumOf(getPromptBundle("1.0.0"))).not.toEqual(enumOf(getPromptBundle("1.1.0")));
  });

  it("1.0.1 is the 1.0.0 prompt text under the newer schema", () => {
    const bundle = getPromptBundle("1.0.1");

    expect(bundle.systemPrompt).toBe(JOB_ANALYSIS_SYSTEM_PROMPT_V1);
    expect(bundle.examples).toBe(jobAnalysisExamples);
    expect(bundle.schemaVersion).toBe("2.0.0");
  });

  it("an output valid for the newer contract can be invalid for the older", () => {
    const withUnknown = {
      summary: "s",
      requiredSkills: [],
      seniority: "unknown",
      interviewTopics: [],
    };

    expect(getPromptBundle("1.0.0").outputSchema.safeParse(withUnknown).success).toBe(false);
    expect(getPromptBundle("1.1.0").outputSchema.safeParse(withUnknown).success).toBe(true);
  });

  it("lists every released version", () => {
    expect(listPromptBundleVersions()).toEqual(["1.0.0", "1.0.1", "1.1.0"]);
  });

  it("rejects an unknown version and lists the known ones", () => {
    expect(() => getPromptBundle("9.9.9")).toThrow(RangeError);
    expect(() => getPromptBundle("9.9.9")).toThrow(/Known versions: 1\.0\.0, 1\.0\.1, 1\.1\.0/);
  });
});

describe("a bundle cannot contradict itself", () => {
  it("every released bundle's examples satisfy that bundle's own schema", () => {
    for (const version of listPromptBundleVersions()) {
      const bundle = getPromptBundle(version);

      for (const example of bundle.examples) {
        expect(bundle.outputSchema.safeParse(example.output).success, `${version}`).toBe(true);
      }
    }
  });

  it("refuses an example that its schema version does not allow", () => {
    // "unknown" did not exist in schema 1.0.0.
    expect(() =>
      createPromptBundle({
        version: "bad",
        schemaVersion: "1.0.0",
        systemPrompt: "SYSTEM",
        examples: [unknownSeniorityExample],
      }),
    ).toThrow(/example 0 does not satisfy output schema 1\.0\.0/);
  });

  it("accepts the same example under a schema version that allows it", () => {
    expect(() =>
      createPromptBundle({
        version: "ok",
        schemaVersion: "2.0.0",
        systemPrompt: "SYSTEM",
        examples: [unknownSeniorityExample],
      }),
    ).not.toThrow();
  });

  it("refuses an unknown schema version", () => {
    expect(() =>
      createPromptBundle({ version: "x", schemaVersion: "9.9.9", systemPrompt: "S", examples: [] }),
    ).toThrow(RangeError);
  });
});

describe("released bundles are frozen", () => {
  // If one of these fails you edited a released bundle (its prompt text, its
  // examples, its schema or its version numbers). Do not update the hash.
  // Results recorded against that version would stop meaning what they meant.
  // Add a NEW bundle version instead.
  const RELEASED_FINGERPRINTS: Record<string, string> = {
    "1.0.0": "cbd28a31c244b082a32b191fe239725b49fba682f0a72311ec3b7902a85ee68d",
    "1.0.1": "e5881f3e1bd5defce45b5a08934e07c311870450357768d60c5f2c13c51ef609",
    "1.1.0": "0c99a17d230c2a12dd2ca24710781d0f768de654d98bde2abb90b2236d169f12",
  };

  it.each(Object.entries(RELEASED_FINGERPRINTS))("bundle %s is unchanged", (version, expected) => {
    expect(fingerprintBundle(getPromptBundle(version))).toBe(expected);
  });

  it("every registered version has a pinned fingerprint", () => {
    expect(Object.keys(RELEASED_FINGERPRINTS).sort()).toEqual(listPromptBundleVersions().sort());
  });

  it("the fingerprint changes when anything that shapes behaviour changes", () => {
    const base = {
      version: "t",
      schemaVersion: "2.0.0",
      systemPrompt: "SYSTEM",
      examples: jobAnalysisExamples,
    };
    const fingerprint = (override: Partial<typeof base>) =>
      fingerprintBundle(createPromptBundle({ ...base, ...override }));
    const original = fingerprint({});

    expect(fingerprint({})).toBe(original); // stable
    expect(fingerprint({ systemPrompt: "SYSTEM " })).not.toBe(original);
    expect(fingerprint({ examples: jobAnalysisExamples.slice(1) })).not.toBe(original);
    expect(fingerprint({ schemaVersion: "1.0.0" })).not.toBe(original);
    expect(fingerprint({ version: "t2" })).not.toBe(original);
  });
});
