import { describe, expect, it, vi } from "vitest";

import { LlmProviderError, LlmTimeoutError } from "../src/llm/errors";
import { OllamaProvider } from "../src/llm/ollama.provider";
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

  describe("validates under the contract the output was produced with", () => {
    const withUnknown = {
      summary: "Developer role. The posting gives few details.",
      requiredSkills: [],
      seniority: "unknown",
      interviewTopics: [],
    };

    const providerReporting = (schemaVersion: string | undefined) =>
      ({
        analyzeJobDescription: vi.fn().mockResolvedValue({
          data: withUnknown,
          metadata: { model: "m", inputTokens: 0, outputTokens: 0, durationMs: 0, schemaVersion },
        }),
      }) satisfies LlmProvider;

    it("rejects 'unknown' from output produced under schema 1.0.0, which did not allow it", async () => {
      await expect(
        new JobAnalysisService(providerReporting("1.0.0")).analyze("A job"),
      ).rejects.toBeInstanceOf(JobAnalysisValidationError);
    });

    it("accepts the same output when it was produced under schema 2.0.0", async () => {
      const result = await new JobAnalysisService(providerReporting("2.0.0")).analyze("A job");

      expect(result.data.seniority).toBe("unknown");
    });

    it("uses the current schema when no schema version is reported", async () => {
      const result = await new JobAnalysisService(providerReporting(undefined)).analyze("A job");

      expect(result.data.seniority).toBe("unknown");
    });

    it("fails loudly for a schema version it does not know, instead of guessing", async () => {
      await expect(
        new JobAnalysisService(providerReporting("9.9.9")).analyze("A job"),
      ).rejects.toBeInstanceOf(RangeError);
    });

    it("an old prompt version is judged by the old contract all the way from the provider", async () => {
      // End to end: the real provider picks the 1.0.0 bundle, the model (a
      // stub) answers "unknown", and the service must apply schema 1.0.0.
      const chat = vi.fn().mockResolvedValue({
        model: "m",
        message: { content: JSON.stringify(withUnknown) },
      });
      const oldPrompt = new OllamaProvider({ client: { chat } as never, promptVersion: "1.0.0" });
      const newPrompt = new OllamaProvider({ client: { chat } as never, promptVersion: "1.1.0" });

      await expect(new JobAnalysisService(oldPrompt).analyze("A job")).rejects.toBeInstanceOf(
        JobAnalysisValidationError,
      );
      await expect(new JobAnalysisService(newPrompt).analyze("A job")).resolves.toMatchObject({
        data: { seniority: "unknown" },
        metadata: { promptVersion: "1.1.0", schemaVersion: "2.0.0" },
      });
    });

    it("the default mock provider declares the current schema version", async () => {
      const result = await new JobAnalysisService().analyze("A job");

      expect(result.metadata.schemaVersion).toBe("2.0.0");
    });
  });

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
