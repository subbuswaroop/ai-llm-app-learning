import { ZodError } from "zod";
import { JobAnalysis, JobAnalysisSchema } from "../schemas/job-analysis.schema";

/**
 * Produces a raw (untrusted) job analysis for a job description.
 * Today this is a mock; later it will be backed by a real LLM call.
 */
export type JobAnalysisProvider = (jobDescription: string) => Promise<unknown>;

export const MOCK_JOB_ANALYSIS = {
  summary:
    "Backend engineer building and maintaining TypeScript APIs for a recruiting platform.",
  requiredSkills: ["TypeScript", "Node.js", "REST APIs", "PostgreSQL"],
  seniority: "mid",
  interviewTopics: ["API design", "Database modeling", "Testing strategies"],
};

export const mockJobAnalysisProvider: JobAnalysisProvider = async () =>
  structuredClone(MOCK_JOB_ANALYSIS);

export class JobAnalysisValidationError extends Error {
  constructor(public readonly cause: ZodError) {
    super(`Invalid job analysis response: ${cause.message}`);
    this.name = "JobAnalysisValidationError";
  }
}

export class JobAnalysisService {
  constructor(private readonly provider: JobAnalysisProvider = mockJobAnalysisProvider) {}

  async analyze(jobDescription: string): Promise<JobAnalysis> {
    const raw = await this.provider(jobDescription);
    const result = JobAnalysisSchema.safeParse(raw);

    if (!result.success) {
      throw new JobAnalysisValidationError(result.error);
    }

    return result.data;
  }
}
