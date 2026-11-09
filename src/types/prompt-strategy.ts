/**
 * How the prompt is built:
 * - "zero-shot": system prompt and the real input only.
 * - "few-shot": the same, plus worked examples shown before the real input.
 */
export const PROMPT_STRATEGIES = ["zero-shot", "few-shot"] as const;

export type PromptStrategy = (typeof PROMPT_STRATEGIES)[number];

export const DEFAULT_PROMPT_STRATEGY: PromptStrategy = "few-shot";

export function isPromptStrategy(value: unknown): value is PromptStrategy {
  return (PROMPT_STRATEGIES as readonly unknown[]).includes(value);
}
