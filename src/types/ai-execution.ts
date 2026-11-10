import type { PromptStrategy } from "./prompt-strategy";

export interface AIExecutionMetadata {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Version of the prompt that produced this result, for reproducibility. */
  promptVersion?: string;
  /**
   * Version of the output schema the model was held to. The service validates
   * the response against this same version, not against whichever schema is
   * current. When absent, the current schema is used.
   */
  schemaVersion?: string;
  /** Whether few-shot examples were included in the prompt. */
  promptStrategy?: PromptStrategy;
}

export interface AIResult<T> {
  data: T;
  metadata: AIExecutionMetadata;
}
