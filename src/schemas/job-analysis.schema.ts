import { z } from "zod";

export const SeniorityLevelSchema = z
  .enum(["junior", "mid", "senior"])
  .describe("Seniority level the role is aimed at");

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

export type SeniorityLevel =z.infer<typeof SeniorityLevelSchema>;
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;
