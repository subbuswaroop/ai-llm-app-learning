import { ZodError } from "zod";
import type { LlmProvider } from "../llm/llm-provider";
import { JobAnalysis, JobAnalysisSchema } from "../schemas/job-analysis.schema";
import type { AIResult } from "../types/ai-execution";

/** The caller supplied unusable input. Nothing was sent to the LLM. */
export class EmptyJobDescriptionError extends Error {
  constructor() {
    super("Job description must not be empty");
    this.name = "EmptyJobDescriptionError";
  }
}

/** The LLM answered, but its content is not a valid job analysis. */
export class JobAnalysisValidationError extends Error {
  constructor(public readonly cause: ZodError) {
    super(`Invalid job analysis response: ${cause.message}`);
    this.name = "JobAnalysisValidationError";
  }
}

export const MOCK_JOB_ANALYSIS = {
  summary:
    "Backend engineer building and maintaining TypeScript APIs for a recruiting platform.",
  requiredSkills: ["TypeScript", "Node.js", "REST APIs", "PostgreSQL"],
  seniority: "mid",
  interviewTopics: ["API design", "Database modeling", "Testing strategies"],
};

/** A provider that returns a fixed response without calling any LLM. */
export class MockLlmProvider implements LlmProvider {
  async analyzeJobDescription(): Promise<AIResult<unknown>> {
    return {
      data: structuredClone(MOCK_JOB_ANALYSIS),
      metadata: { model: "mock", inputTokens: 0, outputTokens: 0, durationMs: 0 },
    };
  }
}

/**
 * Owns the business rules for job analysis: what input is acceptable and
 * what counts as a valid result. It knows nothing about how the LLM is
 * reached, so any LlmProvider can be plugged in.
 */
export class JobAnalysisService {
  constructor(private readonly provider: LlmProvider = new MockLlmProvider()) {}

  async analyze(jobDescription: string): Promise<AIResult<JobAnalysis>> {
    if (jobDescription.trim().length === 0) {
      throw new EmptyJobDescriptionError();
    }

    const { data: raw, metadata } =
      await this.provider.analyzeJobDescription(jobDescription);

    const validation = JobAnalysisSchema.safeParse(raw);
    if (!validation.success) {
      throw new JobAnalysisValidationError(validation.error);
    }

    return { data: validation.data, metadata };
  }
}
