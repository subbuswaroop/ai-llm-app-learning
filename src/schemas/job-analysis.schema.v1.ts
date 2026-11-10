import { z } from "zod";

/**
 * Output schema 1.0.0: seniority is junior, mid or senior only.
 *
 * FROZEN. This is the contract that prompt bundle 1.0.0 was released with.
 * Do not edit it: results recorded against schema 1.0.0 would stop meaning
 * what they meant. To change the output contract, add a new schema version
 * (see schema-registry.ts).
 */
export const JobAnalysisSchemaV1 = z.object({
  summary: z
    .string()
    .trim()
    .min(1, "Summary must not be empty")
    .describe("One or two sentence summary of the role"),
  requiredSkills: z
    .array(z.string())
    .describe("Technical skills explicitly required by the job description"),
  seniority: z
    .enum(["junior", "mid", "senior"])
    .describe("Seniority level the role is aimed at"),
  interviewTopics: z
    .array(z.string())
    .describe("Topics worth covering in an interview for this role"),
});
