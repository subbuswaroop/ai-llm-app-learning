import {
  jobAnalysisExamples,
  jobAnalysisExamplesWithUnknown,
} from "./job-analysis.examples";
import {
  createJobAnalysisPrompt,
  JOB_ANALYSIS_SYSTEM_PROMPT_V1,
  JOB_ANALYSIS_SYSTEM_PROMPT_V1_1,
  type JobAnalysisPrompt,
} from "./job-analysis.prompt";

/**
 * Every released job-analysis prompt, by version.
 *
 * Old versions stay registered so a result recorded against "1.0.0" can be
 * reproduced, and so two versions can be compared on the same inputs. To
 * change the prompt, add a new entry and move CURRENT_JOB_ANALYSIS_PROMPT_VERSION;
 * do not edit a released one.
 *
 * - 1.0.0: seniority is junior, mid or senior only.
 * - 1.1.0: adds "unknown" for postings with no clear evidence of the level,
 *          and an example that shows it.
 *
 * Note that the JSON Schema sent to the model is shared by all versions, so
 * it is part of what a version's results depend on too.
 */
const jobAnalysisPrompts: ReadonlyMap<string, JobAnalysisPrompt> = new Map(
  [
    createJobAnalysisPrompt({
      version: "1.0.0",
      systemPrompt: JOB_ANALYSIS_SYSTEM_PROMPT_V1,
      examples: jobAnalysisExamples,
    }),
    createJobAnalysisPrompt({
      version: "1.1.0",
      systemPrompt: JOB_ANALYSIS_SYSTEM_PROMPT_V1_1,
      examples: jobAnalysisExamplesWithUnknown,
    }),
  ].map((prompt) => [prompt.version, prompt])
);

export const CURRENT_JOB_ANALYSIS_PROMPT_VERSION = "1.1.0";

/** Looks up a prompt by version, defaulting to the current one. */
export function getJobAnalysisPrompt(
  version: string = CURRENT_JOB_ANALYSIS_PROMPT_VERSION
): JobAnalysisPrompt {
  const prompt = jobAnalysisPrompts.get(version);

  if (!prompt) {
    const known = [...jobAnalysisPrompts.keys()].join(", ");
    throw new RangeError(
      `Unknown job analysis prompt version "${version}". Known versions: ${known}`
    );
  }

  return prompt;
}
