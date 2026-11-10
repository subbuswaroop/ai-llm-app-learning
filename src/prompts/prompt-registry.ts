import {
  jobAnalysisExamples,
  jobAnalysisExamplesWithUnknown,
} from "./job-analysis.examples";
import {
  JOB_ANALYSIS_SYSTEM_PROMPT_V1,
  JOB_ANALYSIS_SYSTEM_PROMPT_V1_1,
} from "./job-analysis.prompt";
import { createPromptBundle, type PromptBundle } from "./prompt-bundle";

/**
 * Every released prompt bundle, by version. A bundle is the prompt text, its
 * examples AND the output schema version it was released with, so a result
 * recorded against a version can be reproduced under the contract it was
 * produced with.
 *
 * Released bundles are never edited (a test pins each one's fingerprint). To
 * change anything, add a new bundle and move CURRENT_PROMPT_BUNDLE_VERSION.
 *
 * - 1.0.0: prompt without "unknown", output schema 1.0.0 (three levels).
 * - 1.0.1: the same prompt text as 1.0.0 but with output schema 2.0.0, which
 *          allows "unknown". Evaluated and NOT adopted: the model never used
 *          "unknown", because the prompt still told it to pick one of three.
 *          Kept so that comparison stays reproducible.
 * - 1.1.0: prompt that allows "unknown" and an example showing it, with
 *          output schema 2.0.0. Current.
 */
const bundles: ReadonlyMap<string, PromptBundle> = new Map(
  [
    createPromptBundle({
      version: "1.0.0",
      schemaVersion: "1.0.0",
      systemPrompt: JOB_ANALYSIS_SYSTEM_PROMPT_V1,
      examples: jobAnalysisExamples,
    }),
    createPromptBundle({
      version: "1.0.1",
      schemaVersion: "2.0.0",
      systemPrompt: JOB_ANALYSIS_SYSTEM_PROMPT_V1,
      examples: jobAnalysisExamples,
    }),
    createPromptBundle({
      version: "1.1.0",
      schemaVersion: "2.0.0",
      systemPrompt: JOB_ANALYSIS_SYSTEM_PROMPT_V1_1,
      examples: jobAnalysisExamplesWithUnknown,
    }),
  ].map((bundle) => [bundle.version, bundle])
);

export const CURRENT_PROMPT_BUNDLE_VERSION = "1.1.0";

export function listPromptBundleVersions(): string[] {
  return [...bundles.keys()];
}

/** Looks up a whole bundle by version, defaulting to the current one. */
export function getPromptBundle(version: string = CURRENT_PROMPT_BUNDLE_VERSION): PromptBundle {
  const bundle = bundles.get(version);

  if (!bundle) {
    throw new RangeError(
      `Unknown prompt bundle version "${version}". Known versions: ${listPromptBundleVersions().join(", ")}`
    );
  }

  return bundle;
}
