import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LlmInvalidJsonError,
  LlmOutputTruncatedError,
  LlmProviderError,
  LlmTimeoutError,
} from "../src/llm/errors";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  OllamaProvider,
} from "../src/llm/ollama.provider";
import {
  CURRENT_JOB_ANALYSIS_PROMPT_VERSION,
  getJobAnalysisPrompt,
} from "../src/prompts/prompt-registry";
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

describe("OllamaProvider: prompt", () => {
  it("sends the messages built by the prompt module", async () => {
    const { provider, chat } = providerReplying(JSON.stringify(validAnalysis));

    await provider.analyzeJobDescription("Senior Go engineer");

    expect(chat.mock.calls[0]?.[0].messages).toEqual(
      getJobAnalysisPrompt().buildMessages({ jobDescription: "Senior Go engineer" }),
    );
  });

  it("passes company context through to the prompt", async () => {
    const { provider, chat } = providerReplying(JSON.stringify(validAnalysis));

    await provider.analyzeJobDescription("Senior Go engineer", {
      companyContext: "A payments company.",
    });

    const messages = chat.mock.calls[0]?.[0].messages;
    expect(messages.at(-1).content).toContain(
      "<company_context>\nA payments company.\n</company_context>",
    );
    expect(messages.at(-1).content).toContain("Senior Go engineer");
  });

  it("includes the system prompt and few-shot examples in the request", async () => {
    const { provider, chat } = providerReplying(JSON.stringify(validAnalysis));

    await provider.analyzeJobDescription("Any job");

    const roles = chat.mock.calls[0]?.[0].messages.map((m: { role: string }) => m.role);
    expect(roles[0]).toBe("system");
    expect(roles).toContain("assistant");
    expect(roles.at(-1)).toBe("user");
  });

  it("sends no few-shot examples for the zero-shot strategy", async () => {
    const { provider, chat } = providerReplying(JSON.stringify(validAnalysis));

    await provider.analyzeJobDescription("Any job", { strategy: "zero-shot" });

    const roles = chat.mock.calls[0]?.[0].messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["system", "user"]);
  });

  it("sends the examples for the few-shot strategy", async () => {
    const { provider, chat } = providerReplying(JSON.stringify(validAnalysis));

    await provider.analyzeJobDescription("Any job", { strategy: "few-shot" });

    const roles = chat.mock.calls[0]?.[0].messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("assistant");
  });

  it("records which strategy was used in the execution metadata", async () => {
    const { provider } = providerReplying(JSON.stringify(validAnalysis));

    const zero = await provider.analyzeJobDescription("Any job", { strategy: "zero-shot" });
    const few = await provider.analyzeJobDescription("Any job", { strategy: "few-shot" });

    expect(zero.metadata.promptStrategy).toBe("zero-shot");
    expect(few.metadata.promptStrategy).toBe("few-shot");
  });

  it("rejects an unknown strategy instead of silently using a default", async () => {
    const { provider, chat } = providerReplying(JSON.stringify(validAnalysis));

    await expect(
      provider.analyzeJobDescription("Any job", { strategy: "many-shot" as never }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(chat).not.toHaveBeenCalled();
  });

  it("records the prompt version in the execution metadata", async () => {
    const { provider } = providerReplying(JSON.stringify(validAnalysis));

    const { metadata } = await provider.analyzeJobDescription("Any job");

    expect(metadata.promptVersion).toBe(CURRENT_JOB_ANALYSIS_PROMPT_VERSION);
  });

  it("rejects an unknown prompt version when constructed, not on first use", () => {
    expect(() => new OllamaProvider({ promptVersion: "9.9.9" })).toThrow(RangeError);
  });

  it("contains no prompt text itself: prompt construction lives in src/prompts", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/llm/ollama.provider.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/technical recruiter/i);
    expect(source).not.toMatch(/role:\s*["']system["']/);
  });
});

describe("OllamaProvider: output limit", () => {
  const providerWith = (
    reply: object,
    options: { maxOutputTokens?: number } = {},
  ) => {
    const chat = vi.fn().mockResolvedValue(reply);
    const provider = new OllamaProvider({ client: { chat } as never, ...options });
    return { provider, chat };
  };

  it("sends the default token limit as num_predict", async () => {
    const { provider, chat } = providerWith(ollamaReply(JSON.stringify(validAnalysis)));

    await provider.analyzeJobDescription("Any job");

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          temperature: 0.1,
          num_predict: DEFAULT_MAX_OUTPUT_TOKENS,
        }),
      }),
    );
  });

  it("sends a custom token limit as num_predict", async () => {
    const { provider, chat } = providerWith(
      ollamaReply(JSON.stringify(validAnalysis)),
      { maxOutputTokens: 800 },
    );

    await provider.analyzeJobDescription("Any job");

    expect(chat.mock.calls[0]?.[0].options.num_predict).toBe(800);
  });

  it("accepts a response that finished normally", async () => {
    const { provider } = providerWith({
      ...ollamaReply(JSON.stringify(validAnalysis)),
      done_reason: "stop",
    });

    await expect(provider.analyzeJobDescription("Any job")).resolves.toMatchObject({
      data: validAnalysis,
    });
  });

  it("reports a response cut off by the limit as truncated, not as invalid JSON", async () => {
    // A cut-off JSON document is also unparseable, so without the explicit
    // check this would be misreported as LlmInvalidJsonError.
    const { provider } = providerWith(
      {
        ...ollamaReply('{"summary": "Senior frontend role.", "requiredSki'),
        done_reason: "length",
        eval_count: 800,
      },
      { maxOutputTokens: 800 },
    );

    const error = await provider
      .analyzeJobDescription("Any job")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmOutputTruncatedError);
    expect(error).not.toBeInstanceOf(LlmInvalidJsonError);
    expect((error as LlmOutputTruncatedError).maxOutputTokens).toBe(800);
    expect((error as LlmOutputTruncatedError).outputTokens).toBe(800);
  });

  it("reports truncation even when the cut-off happened before any answer (empty content)", async () => {
    // Possible if thinking tokens use up the whole budget.
    const { provider } = providerWith({
      ...ollamaReply(""),
      done_reason: "length",
      eval_count: 1500,
    });

    await expect(provider.analyzeJobDescription("Any job")).rejects.toBeInstanceOf(
      LlmOutputTruncatedError,
    );
  });

  it("does not leak the partial output through the truncation error", async () => {
    const { provider } = providerWith({
      ...ollamaReply('{"summary": "SECRET-PII jane.doe@example.com'),
      done_reason: "length",
      eval_count: 800,
    });

    const error = await provider
      .analyzeJobDescription("Any job")
      .catch((e: unknown) => e);

    const logged = inspect(error, { depth: 10, showHidden: true });
    expect(logged).not.toContain("SECRET-PII");
    expect(logged).not.toContain("jane.doe");
  });

  it.each([0, -1, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid maxOutputTokens of %s",
    (value) => {
      // -1 and -2 mean "unlimited" to Ollama, which would defeat the limit.
      expect(() => new OllamaProvider({ maxOutputTokens: value })).toThrow(RangeError);
    },
  );
});

describe("OllamaProvider: model output", () => {
  it("returns a controlled error for invalid JSON", async () => {
    const content = "Sure! Here is the analysis: ...";
    const { provider } = providerReplying(content);

    const error = await provider
      .analyzeJobDescription("Any job")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmInvalidJsonError);
    expect((error as LlmInvalidJsonError).contentLength).toBe(content.length);
  });

  it("does not leak the model's output through the invalid JSON error", async () => {
    // Model output can contain sensitive, user-supplied text. Errors get
    // logged, so nothing derived from the content may be reachable from one,
    // including through `cause` (JSON.parse's SyntaxError quotes the input).
    const secret = "SECRET-PII jane.doe@example.com";
    const { provider } = providerReplying(`${secret} is not json`);

    const error = await provider
      .analyzeJobDescription("Any job")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmInvalidJsonError);
    const logged = inspect(error, { depth: 10, showHidden: true });
    expect(logged).not.toContain("SECRET-PII");
    expect(logged).not.toContain("jane.doe");
    expect(JSON.stringify(error)).not.toContain("SECRET-PII");
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

/** Mimics the error Node's fetch throws when a connection fails. */
function fetchFailure(code: string) {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(`connect ${code}`), { code }),
  });
}

/** Mimics the `ollama` package's ResponseError (which it does not export). */
function ollamaResponseError(message: string, status_code: number) {
  return Object.assign(new Error(message), {
    name: "ResponseError",
    status_code,
  });
}

/** Runs the provider against a client whose chat() rejects with `failure`. */
async function failWith(failure: unknown) {
  const chat = vi.fn().mockRejectedValue(failure);
  const provider = new OllamaProvider({ client: { chat } as never });
  return provider.analyzeJobDescription("Any job").catch((e: unknown) => e);
}

describe("OllamaProvider: provider failure", () => {
  it.each(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"])(
    "classifies a %s connection failure as a LlmProviderError",
    async (code) => {
      const failure = fetchFailure(code);

      const error = await failWith(failure);

      expect(error).toBeInstanceOf(LlmProviderError);
      expect((error as LlmProviderError).message).toMatch(/Is it running/);
      expect((error as LlmProviderError).cause).toBe(failure);
    },
  );

  it("classifies an Ollama error response as a LlmProviderError with its status", async () => {
    const failure = ollamaResponseError("model 'gemma4' not found", 404);

    const error = await failWith(failure);

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).message).toContain("404");
    expect((error as LlmProviderError).message).toContain("model 'gemma4' not found");
    expect((error as LlmProviderError).cause).toBe(failure);
  });
});

describe("OllamaProvider: unexpected errors are not masked", () => {
  it("does not treat a programming TypeError as a connectivity failure", async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'x')");

    const error = await failWith(bug);

    expect(error).toBe(bug);
    expect(error).not.toBeInstanceOf(LlmProviderError);
  });

  it("does not treat 'fetch failed' without a known network code as connectivity", async () => {
    const unknown = new TypeError("fetch failed", {
      cause: Object.assign(new Error("bad port"), { code: "ERR_SOMETHING_ELSE" }),
    });

    const error = await failWith(unknown);

    expect(error).toBe(unknown);
  });

  it("does not treat 'fetch failed' with no cause as connectivity", async () => {
    const bare = new TypeError("fetch failed");

    expect(await failWith(bare)).toBe(bare);
  });

  it("passes a plain Error through unchanged", async () => {
    const unexpected = new Error("something we have never seen");

    expect(await failWith(unexpected)).toBe(unexpected);
  });

  it("passes a non-Error rejection through unchanged", async () => {
    expect(await failWith("a string was thrown")).toBe("a string was thrown");
  });

  it("does not mistake a lookalike ResponseError without a status for an Ollama error", async () => {
    const lookalike = Object.assign(new Error("nope"), { name: "ResponseError" });

    expect(await failWith(lookalike)).toBe(lookalike);
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
