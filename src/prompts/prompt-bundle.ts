import { createHash } from "node:crypto";
import type { z } from "zod";

import type { JobAnalysis } from "../schemas/job-analysis.schema";
import { getOutputSchema } from "../schemas/schema-registry";
import {
  DEFAULT_PROMPT_STRATEGY,
  isPromptStrategy,
  PROMPT_STRATEGIES,
  type PromptStrategy,
} from "../types/prompt-strategy";
import type { JobAnalysisExample } from "./job-analysis.examples";
import {
  formatUserMessage,
  type ChatMessage,
  type JobAnalysisPromptInput,
} from "./job-analysis.prompt";

/**
 * Everything that defines how one release of the job-analysis prompt behaves,
 * kept together: the instructions, the examples, and the output contract the
 * model is held to.
 *
 * Fetch the whole bundle by version. Taking the prompt from one place and the
 * schema from another would let an old prompt be judged by a newer contract,
 * which makes historical results impossible to reproduce.
 */
export interface PromptBundle {
  /** Version of the prompt text and examples. */
  readonly version: string;
  /** Version of the output schema this bundle is released with. */
  readonly schemaVersion: string;
  readonly systemPrompt: string;
  readonly examples: readonly JobAnalysisExample[];
  /** Validates what the model returns, under this bundle's contract. */
  readonly outputSchema: z.ZodType<JobAnalysis>;
  /** Generated from `outputSchema`. Sent to the model to constrain its output. */
  readonly outputJsonSchema: object;
  /** Turns a request into chat messages for this bundle. */
  buildMessages(input: JobAnalysisPromptInput, strategy?: PromptStrategy): ChatMessage[];
}

export interface CreatePromptBundleConfig {
  version: string;
  schemaVersion: string;
  systemPrompt: string;
  /** Few-shot examples. Use an empty array for a zero-shot-only bundle. */
  examples: readonly JobAnalysisExample[];
}

/**
 * Builds a bundle. Messages are laid out as:
 *   system, then (user, assistant) for each example, then the real user input.
 * Each example is formatted exactly like the real input so the model sees a
 * consistent pattern, and its answer is the JSON we want back.
 *
 * The strategy decides whether the examples are included. Zero-shot sends
 * the identical system prompt and real input with no examples, so the only
 * difference between the two strategies is the examples themselves.
 *
 * Throws if the schema version is unknown, or if any example's answer does
 * not satisfy the bundle's own schema. A bundle that contradicts itself
 * (for example a 1.0.0 example answering "unknown") must not exist.
 */
export function createPromptBundle(config: CreatePromptBundleConfig): PromptBundle {
  const schema = getOutputSchema(config.schemaVersion);

  config.examples.forEach((example, index) => {
    const result = schema.zod.safeParse(example.output);
    if (!result.success) {
      throw new Error(
        `Prompt bundle ${config.version}: example ${index} does not satisfy output schema ` +
          `${config.schemaVersion}: ${result.error.message}`
      );
    }
  });

  return {
    version: config.version,
    schemaVersion: config.schemaVersion,
    systemPrompt: config.systemPrompt,
    examples: config.examples,
    outputSchema: schema.zod,
    outputJsonSchema: schema.jsonSchema,

    buildMessages(input, strategy = DEFAULT_PROMPT_STRATEGY) {
      if (!isPromptStrategy(strategy)) {
        throw new RangeError(
          `Unknown prompt strategy "${String(strategy)}". ` +
            `Known strategies: ${PROMPT_STRATEGIES.join(", ")}`
        );
      }

      const messages: ChatMessage[] = [{ role: "system", content: config.systemPrompt }];

      const examples = strategy === "few-shot" ? config.examples : [];

      for (const example of examples) {
        messages.push(
          { role: "user", content: formatUserMessage(example) },
          { role: "assistant", content: JSON.stringify(example.output) }
        );
      }

      messages.push({ role: "user", content: formatUserMessage(input) });

      return messages;
    },
  };
}

/**
 * A fingerprint of everything that shapes a bundle's behaviour: its version,
 * schema version, system prompt, examples and the JSON Schema sent to the
 * model. Tests pin the fingerprint of each released bundle, so editing a
 * released version in place fails a test instead of silently changing what
 * old results mean.
 */
export function fingerprintBundle(bundle: PromptBundle): string {
  const canonical = JSON.stringify({
    version: bundle.version,
    schemaVersion: bundle.schemaVersion,
    systemPrompt: bundle.systemPrompt,
    examples: bundle.examples,
    outputJsonSchema: bundle.outputJsonSchema,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
