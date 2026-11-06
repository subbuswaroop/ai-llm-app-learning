import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LlmInvalidJsonError,
  LlmProviderError,
  LlmTimeoutError,
} from "../src/llm/errors";
import { OllamaProvider } from "../src/llm/ollama.provider";
import { JobAnalysisJsonSchema } from "../src/schemas/job-analysis.schema";

const validAnalysis = {
  summary: "Senior frontend role.",
  requiredSkills: ["React", "TypeScript"],
  seniority: "senior",
  interviewTopics: ["Architecture"],
};

const ollamaReply = (content: string) => ({
  model: "gemma4",
  message: { content },
  prompt_eval_count: 10,
  eval_count: 20,
});

/** A provider whose Ollama client always answers with `content`. */
function providerReplying(content: string) {
  const chat = vi.fn().mockResolvedValue(ollamaReply(content));
  const provider = new OllamaProvider({ client: { chat } as never });
  return { provider, chat };
}

describe("OllamaProvider: successful path", () => {
  it("sends the generated JSON Schema in the `format` parameter", async () => {
    const { provider, chat } = providerReplying(JSON.stringify(validAnalysis));

    await provider.analyzeJobDescription("Any job");

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ format: JobAnalysisJsonSchema, stream: false }),
    );
  });

  it("parses and validates a well-formed response", async () => {
    const { provider } = providerReplying(JSON.stringify(validAnalysis));

    const result = await provider.analyzeJobDescription("Any job");

    expect(result.data).toEqual(validAnalysis);
    expect(result.metadata).toMatchObject({
      model: "gemma4",
      inputTokens: 10,
      outputTokens: 20,
    });
  });
});

describe("OllamaProvider: execution metadata", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures model name and input/output token counts from Ollama", async () => {
    const chat = vi.fn().mockResolvedValue({
      model: "gemma4:latest",
      message: { content: JSON.stringify(validAnalysis) },
      prompt_eval_count: 141,
      eval_count: 631,
    });
    const provider = new OllamaProvider({ client: { chat } as never });

    const { metadata } = await provider.analyzeJobDescription("Any job");

    expect(metadata.model).toBe("gemma4:latest");
    expect(metadata.inputTokens).toBe(141);
    expect(metadata.outputTokens).toBe(631);
  });

  it("captures execution duration in milliseconds", async () => {
    // First Date.now() is the start time, the second is the end time.
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(26_671);
    const { provider } = providerReplying(JSON.stringify(validAnalysis));

    const { metadata } = await provider.analyzeJobDescription("Any job");

    expect(metadata.durationMs).toBe(25_671);
  });

  it("reports 0 tokens when Ollama omits the counts", async () => {
    const chat = vi.fn().mockResolvedValue({
      model: "gemma4",
      message: { content: JSON.stringify(validAnalysis) },
    });
    const provider = new OllamaProvider({ client: { chat } as never });

    const { metadata } = await provider.analyzeJobDescription("Any job");

    expect(metadata.inputTokens).toBe(0);
    expect(metadata.outputTokens).toBe(0);
  });
});

describe("OllamaProvider: model output", () => {
  it("returns a controlled error for invalid JSON", async () => {
    const { provider } = providerReplying("Sure! Here is the analysis: ...");

    const error = await provider
      .analyzeJobDescription("Any job")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmInvalidJsonError);
    expect((error as LlmInvalidJsonError).rawContent).toBe(
      "Sure! Here is the analysis: ...",
    );
  });

  it("does not validate business rules: it returns the parsed JSON as-is", async () => {
    // Valid JSON, but not a valid job analysis. Rejecting this is the
    // service's job, not the adapter's.
    const notAnAnalysis = { seniority: "principal" };
    const { provider } = providerReplying(JSON.stringify(notAnAnalysis));

    const result = await provider.analyzeJobDescription("Any job");

    expect(result.data).toEqual(notAnAnalysis);
  });
});

describe("OllamaProvider: provider failure", () => {
  it("wraps a connection failure in a LlmProviderError", async () => {
    const cause = new TypeError("fetch failed");
    const chat = vi.fn().mockRejectedValue(cause);
    const provider = new OllamaProvider({ client: { chat } as never });

    const error = await provider
      .analyzeJobDescription("Any job")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).message).toMatch(/Is it running/);
    expect((error as LlmProviderError).cause).toBe(cause);
  });

  it("wraps an Ollama error response in a LlmProviderError", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("model 'gemma4' not found"));
    const provider = new OllamaProvider({ client: { chat } as never });

    await expect(provider.analyzeJobDescription("Any job")).rejects.toMatchObject({
      name: "LlmProviderError",
      message: expect.stringContaining("model 'gemma4' not found"),
    });
  });
});

describe("OllamaProvider: real network failures", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (!running) return;

    running.closeAllConnections();
    await new Promise((resolve) => running.close(resolve));
  });

  /** Starts a local server, then returns its port. */
  async function listen(handler?: Parameters<typeof createServer>[1]) {
    server = createServer(handler);
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    return (server.address() as AddressInfo).port;
  }

  it("throws a provider error when Ollama is unavailable", async () => {
    // Grab a free port, then close it so nothing is listening there.
    const port = await listen();
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;

    const provider = new OllamaProvider({ host: `http://127.0.0.1:${port}` });

    await expect(provider.analyzeJobDescription("Any job")).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });

  it("throws a provider error when Ollama answers with an error status", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "model 'gemma4' not found" }));
    });
    const provider = new OllamaProvider({ host: `http://127.0.0.1:${port}` });

    await expect(provider.analyzeJobDescription("Any job")).rejects.toThrow(
      /model 'gemma4' not found/,
    );
    await expect(provider.analyzeJobDescription("Any job")).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });

  it("throws a controlled timeout error when the model never answers", async () => {
    // Accepts the request but never responds.
    const port = await listen(() => {});
    const provider = new OllamaProvider({
      host: `http://127.0.0.1:${port}`,
      timeoutMs: 200,
    });

    const started = Date.now();
    const error = await provider
      .analyzeJobDescription("Any job")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmTimeoutError);
    expect((error as LlmTimeoutError).timeoutMs).toBe(200);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
