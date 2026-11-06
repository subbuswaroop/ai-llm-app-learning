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

/** The LLM answered, but the content was not parseable JSON. */
export class LlmInvalidJsonError extends Error {
  constructor(
    public readonly rawContent: string,
    public readonly cause: unknown
  ) {
    super("LLM response was not valid JSON");
    this.name = "LlmInvalidJsonError";
  }
}
