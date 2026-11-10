import { Ollama } from "ollama";

import type { PromptBundle } from "../prompts/prompt-bundle";
import { getPromptBundle } from "../prompts/prompt-registry";
import { AIResult } from "../types/ai-execution";
import { DEFAULT_PROMPT_STRATEGY } from "../types/prompt-strategy";
import {
  LlmInvalidJsonError,
  LlmOutputTruncatedError,
  LlmProviderError,
  LlmTimeoutError,
} from "./errors";
import type { AnalyzeOptions, LlmProvider } from "./llm-provider";

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma4";
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Upper bound on tokens the model may generate per call (Ollama's
 * `num_predict`). Without it a looping or runaway model keeps generating
 * until the timeout, tying up the GPU.
 *
 * Measured on gemma4 across 54 runs (see docs/prompt-strategy-comparison.md):
 * few-shot prompts generated 28-352 tokens (median ~52), zero-shot prompts
 * 305-850. 1500 is about 1.8x the largest value seen, so it should not cut
 * off a normal answer, while still stopping a runaway generation. Re-measure
 * when the model, prompt or typical job-description length changes.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1500;

export interface OllamaProviderOptions {
  host?: string;
  model?: string;
  /** Maximum time to wait for the model, in milliseconds. */
  timeoutMs?: number;
  /** Maximum tokens the model may generate per call. Must be a positive integer. */
  maxOutputTokens?: number;
  /** Which registered prompt version to use. Defaults to the current one. */
  promptVersion?: string;
  /** Override the Ollama client (used in tests). */
  client?: Pick<Ollama, "chat">;
}

/**
 * Adapter for a local Ollama server. It only handles talking to Ollama:
 * the request, transport errors, timeouts and JSON parsing. It does NOT
 * decide whether the result is a valid job analysis; that is the job of
 * JobAnalysisService.
 */
export class OllamaProvider implements LlmProvider {
  private readonly client: Pick<Ollama, "chat">;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  /**
   * The whole bundle: prompt text, examples and the output JSON Schema come
   * from the same release, so an old prompt is never run against a newer
   * output contract.
   */
  private readonly bundle: PromptBundle;

  constructor(options: OllamaProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_OLLAMA_MODEL;
    // Throws for an unknown version, so a typo fails at startup, not on
    // the first request.
    this.bundle = getPromptBundle(options.promptVersion);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

    // Ollama treats num_predict of -1 as "unlimited" and -2 as "fill the
    // context", which would silently remove the protection this exists for.
    if (!Number.isInteger(this.maxOutputTokens) || this.maxOutputTokens <= 0) {
      throw new RangeError(
        `maxOutputTokens must be a positive integer, got ${this.maxOutputTokens}`
      );
    }

    this.client =
      options.client ??
      new Ollama({
        host: options.host ?? DEFAULT_OLLAMA_HOST,
        // Cancel the underlying HTTP request when the time limit is hit,
        // so a stuck model doesn't keep a connection open.
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(this.timeoutMs),
          }),
      });
  }

  async analyzeJobDescription(
    description: string,
    options: AnalyzeOptions = {}
  ): Promise<AIResult<unknown>> {
    const startTime = Date.now();

    // What to say to the model is decided by the prompt module, not here.
    const strategy = options.strategy ?? DEFAULT_PROMPT_STRATEGY;
    const messages = this.bundle.buildMessages(
      {
        jobDescription: description,
        companyContext: options.companyContext,
      },
      strategy
    );

    let response;
    try {
      response = await this.client.chat({
        model: this.model,

        messages,

        // Tell Ollama to enforce this JSON structure.
        format: this.bundle.outputJsonSchema,

        stream: false,

        options: {
          temperature: 0.1,
          num_predict: this.maxOutputTokens,
        },
      });
    } catch (error) {
      throw this.toControlledError(error);
    }

    // Hitting the token limit leaves a cut-off answer. Say so explicitly
    // instead of letting it surface as a confusing "invalid JSON" error.
    if (response.done_reason === "length") {
      throw new LlmOutputTruncatedError(
        this.maxOutputTokens,
        response.eval_count ?? 0
      );
    }

    // Parse. The model response is an external data boundary, so even
    // with `format` set we don't assume it is well-formed JSON.
    let rawOutput: unknown;
    try {
      rawOutput = JSON.parse(response.message.content);
    } catch {
      // Don't keep the content or the SyntaxError: both can quote the
      // model's output, which may contain sensitive user data.
      throw new LlmInvalidJsonError(response.message.content.length);
    }

    // The parsed value is returned as `unknown`: it is untrusted until the
    // service validates it.
    return {
      data: rawOutput,
      metadata: {
        model: response.model,
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
        durationMs: Date.now() - startTime,
        promptVersion: this.bundle.version,
        // Tells the service which contract to validate this output against.
        schemaVersion: this.bundle.schemaVersion,
        promptStrategy: strategy,
      },
    };
  }

  /**
   * Convert the failures we can positively identify into our own error
   * types. Anything else is returned unchanged: a TypeError from a bug, or
   * an error we have never seen, should surface as itself instead of being
   * disguised as "Ollama is down".
   */
  private toControlledError(error: unknown): unknown {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return new LlmTimeoutError(this.timeoutMs, error);
    }

    if (isConnectionFailure(error)) {
      return new LlmProviderError("Could not reach Ollama. Is it running?", error);
    }

    // Ollama was reached but answered with an error status
    // (e.g. 404 model not found, 500 model crashed).
    if (isOllamaResponseError(error)) {
      return new LlmProviderError(
        `Ollama returned an error (HTTP ${error.status_code}): ${error.message}`,
        error
      );
    }

    return error;
  }
}

/** Error codes Node's network layer reports when a server can't be reached. */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * Node's fetch reports every network problem as TypeError("fetch failed")
 * with the real reason in `cause.code`. Checking the code, not just the
 * TypeError, keeps genuine programming errors from being mistaken for this.
 */
function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof TypeError) || error.message !== "fetch failed") {
    return false;
  }
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && CONNECTION_ERROR_CODES.has(code);
}

/**
 * The `ollama` package does not export its ResponseError class, so it is
 * recognised by name and by the HTTP status it carries.
 */
function isOllamaResponseError(
  error: unknown
): error is Error & { status_code: number } {
  return (
    error instanceof Error &&
    error.name === "ResponseError" &&
    typeof (error as { status_code?: unknown }).status_code === "number"
  );
}
