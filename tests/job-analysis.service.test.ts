import { describe, expect, it, vi } from "vitest";

import { LlmProviderError, LlmTimeoutError } from "../src/llm/errors";
import type { LlmProvider } from "../src/llm/llm-provider";
import {
  EmptyJobDescriptionError,
  JobAnalysisService,
  JobAnalysisValidationError,
  MOCK_JOB_ANALYSIS,
} from "../src/services/job-analysis.service";
import type { AIExecutionMetadata } from "../src/types/ai-execution";

const metadata: AIExecutionMetadata = {
  model: "test-model",
  inputTokens: 12,
  outputTokens: 34,
  durationMs: 56,
};

/** A provider stub that returns `data` as the model's (untrusted) output. */
function providerReturning(data: unknown) {
  const analyzeJobDescription = vi.fn().mockResolvedValue({ data, metadata });
  const provider: LlmProvider = { analyzeJobDescription };
  return { provider, analyzeJobDescription };
}

describe("JobAnalysisService", () => {
  it("returns the validated mock analysis by default", async () => {
    const service = new JobAnalysisService();

    const result = await service.analyze("Any job description");

    expect(result.data).toEqual(MOCK_JOB_ANALYSIS);
  });

  it("passes the provider's execution metadata through unchanged", async () => {
    const { provider } = providerReturning(MOCK_JOB_ANALYSIS);

    const result = await new JobAnalysisService(provider).analyze("A job");

    expect(result.metadata).toEqual(metadata);
  });

  it("passes optional company context to the provider", async () => {
    const { provider, analyzeJobDescription } = providerReturning(MOCK_JOB_ANALYSIS);

    await new JobAnalysisService(provider).analyze("A job", {
      companyContext: "A fintech startup.",
    });

    expect(analyzeJobDescription).toHaveBeenCalledWith("A job", {
      companyContext: "A fintech startup.",
    });
  });

  it("works without company context", async () => {
    const { provider, analyzeJobDescription } = providerReturning(MOCK_JOB_ANALYSIS);

    await new JobAnalysisService(provider).analyze("A job");

    expect(analyzeJobDescription).toHaveBeenCalledWith("A job", {});
  });

  it("accepts unknown seniority as a valid answer and returns it unchanged", async () => {
    const { provider } = providerReturning({
      summary: "Developer role. The posting gives few details.",
      requiredSkills: [],
      seniority: "unknown",
      interviewTopics: [],
    });

    const result = await new JobAnalysisService(provider).analyze("A vague job");

    expect(result.data.seniority).toBe("unknown");
  });

  it("rejects a response with an invalid seniority value", async () => {
    const { provider } = providerReturning({
      ...MOCK_JOB_ANALYSIS,
      seniority: "principal",
    });

    const error = await new JobAnalysisService(provider)
      .analyze("A job")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JobAnalysisValidationError);
    expect((error as JobAnalysisValidationError).cause.issues[0]?.path).toEqual([
      "seniority",
    ]);
  });

  it("rejects a response with a missing field", async () => {
    const { interviewTopics: _omitted, ...incomplete } = MOCK_JOB_ANALYSIS;
    const { provider } = providerReturning(incomplete);

    await expect(
      new JobAnalysisService(provider).analyze("A job"),
    ).rejects.toBeInstanceOf(JobAnalysisValidationError);
  });

  it("rejects a response that is not an object", async () => {
    const { provider } = providerReturning("just some text");

    await expect(
      new JobAnalysisService(provider).analyze("A job"),
    ).rejects.toBeInstanceOf(JobAnalysisValidationError);
  });

  it.each(["", "   ", "\n\t  \n"])(
    "rejects an empty job description %j without calling the provider",
    async (input) => {
      const { provider, analyzeJobDescription } = providerReturning(MOCK_JOB_ANALYSIS);

      await expect(
        new JobAnalysisService(provider).analyze(input),
      ).rejects.toBeInstanceOf(EmptyJobDescriptionError);
      expect(analyzeJobDescription).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["provider failure", new LlmProviderError("Could not reach Ollama")],
    ["timeout", new LlmTimeoutError(1000)],
  ])("lets a %s from the provider propagate unchanged", async (_name, failure) => {
    const provider: LlmProvider = {
      analyzeJobDescription: vi.fn().mockRejectedValue(failure),
    };

    await expect(new JobAnalysisService(provider).analyze("A job")).rejects.toBe(
      failure,
    );
  });
});
