import { z } from "zod";

export const SeniorityLevelSchema = z.enum(["junior", "mid", "senior"]);

export const JobAnalysisSchema = z.object({
  summary: z.string().trim().min(1, "Summary must not be empty"),
  requiredSkills: z.array(z.string()),
  seniority: SeniorityLevelSchema,
  interviewTopics: z.array(z.string()),
});

export type SeniorityLevel = z.infer<typeof SeniorityLevelSchema>;
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;
