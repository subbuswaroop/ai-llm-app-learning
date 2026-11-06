export interface AIExecutionMetadata {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface AIResult<T> {
  data: T;
  metadata: AIExecutionMetadata;
}