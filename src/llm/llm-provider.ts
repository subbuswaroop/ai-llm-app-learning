import type { AIResult } from "../types/ai-execution";

/**
 * What the application needs from any LLM backend (Ollama, OpenAI, a mock).
 *
 * A provider is only responsible for talking to the model: sending the
 * request, handling transport failures and returning what the model said.
 * The data it returns is UNTRUSTED (`unknown`): deciding whether it is a
 * valid job analysis is business validation and belongs to the service.
 */
export interface LlmProvider {
  analyzeJobDescription(description: string): Promise<AIResult<unknown>>;
}
