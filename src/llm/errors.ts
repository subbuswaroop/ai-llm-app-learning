/** The LLM provider could not be reached, or answered with an error. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

/** The LLM provider did not answer within the allowed time. */
export class LlmTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly cause?: unknown
  ) {
    super(`LLM did not respond within ${timeoutMs}ms`);
    this.name = "LlmTimeoutError";
  }
}

/**
 * The model hit the output token limit before it finished answering, so
 * whatever it produced is incomplete. This is reported separately from
 * "invalid JSON" because the fix is different (raise the limit, or shorten
 * the input), and retrying unchanged will fail the same way.
 *
 * Carries only numbers, never the partial output (see LlmInvalidJsonError).
 */
export class LlmOutputTruncatedError extends Error {
  constructor(
    public readonly maxOutputTokens: number,
    public readonly outputTokens: number
  ) {
    super(
      `LLM output was cut off at the limit of ${maxOutputTokens} tokens ` +
        `(${outputTokens} generated)`
    );
    this.name = "LlmOutputTruncatedError";
  }
}

/**
 * The LLM answered, but the content was not parseable JSON.
 *
 * Deliberately does NOT carry the model's output or the original
 * SyntaxError: the output is derived from user-supplied text and may be
 * sensitive, and JSON.parse's error message quotes the start of it. Errors
 * get logged, so anything stored here can end up in logs. Only the length is
 * kept, which is enough to tell an empty or truncated response from garbage.
 */
export class LlmInvalidJsonError extends Error {
  constructor(public readonly contentLength: number) {
    super(`LLM response was not valid JSON (${contentLength} characters)`);
    this.name = "LlmInvalidJsonError";
  }
}
