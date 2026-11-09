import { z } from "zod";

/**
 * "unknown" means the job description does not contain enough evidence to
 * pick a level. It exists so the model is never forced to guess: a made-up
 * "mid" for a posting that says nothing about experience looks exactly like
 * a real one downstream.
 */
export const SeniorityLevelSchema = z
  .enum(["junior", "mid", "senior", "unknown"])
  .describe(
    'Seniority level the role is aimed at. Use "unknown" when the job description gives no clear evidence of the level. Do not guess.'
  );

export const JobAnalysisSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1, "Summary must not be empty")
    .describe("One or two sentence summary of the role"),
  requiredSkills: z
    .array(z.string())
    .describe("Technical skills explicitly required by the job description"),
  seniority: SeniorityLevelSchema,
  interviewTopics: z
    .array(z.string())
    .describe("Topics worth covering in an interview for this role"),
});

/**
 * JSON Schema version of JobAnalysisSchema, generated from the Zod schema
 * so the two can never drift apart. Sent to the LLM to constrain its output.
 */
export const JobAnalysisJsonSchema = z.toJSONSchema(JobAnalysisSchema);

export type SeniorityLevel = z.infer<typeof SeniorityLevelSchema>;
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;
