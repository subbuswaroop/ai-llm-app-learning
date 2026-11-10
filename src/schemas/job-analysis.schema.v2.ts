import { z } from "zod";

/**
 * Output schema 2.0.0: adds "unknown" to seniority.
 *
 * "unknown" means the job description does not contain enough evidence to
 * pick a level. It exists so the model is never forced to guess: a made-up
 * "mid" for a posting that says nothing about experience looks exactly like
 * a real one downstream.
 *
 * This is a breaking change for consumers (a new value they must handle),
 * which is why it is a new major schema version. FROZEN once released: do
 * not edit it, add a new version instead (see schema-registry.ts).
 */
export const SeniorityLevelSchemaV2 = z
  .enum(["junior", "mid", "senior", "unknown"])
  .describe(
    'Seniority level the role is aimed at. Use "unknown" when the job description gives no clear evidence of the level. Do not guess.'
  );

export const JobAnalysisSchemaV2 = z.object({
  summary: z
    .string()
    .trim()
    .min(1, "Summary must not be empty")
    .describe("One or two sentence summary of the role"),
  requiredSkills: z
    .array(z.string())
    .describe("Technical skills explicitly required by the job description"),
  seniority: SeniorityLevelSchemaV2,
  interviewTopics: z
    .array(z.string())
    .describe("Topics worth covering in an interview for this role"),
});
