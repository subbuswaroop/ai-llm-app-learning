import { z } from "zod";

import { JobAnalysisSchemaV1 } from "./job-analysis.schema.v1";
import { JobAnalysisSchemaV2 } from "./job-analysis.schema.v2";
import type { JobAnalysis } from "./job-analysis.schema";

/** One released version of the output contract. */
export interface OutputSchemaVersion {
  readonly version: string;
  /** Validates what the model returned. */
  readonly zod: z.ZodType<JobAnalysis>;
  /** Generated from `zod`, so the two cannot drift apart. Sent to the model. */
  readonly jsonSchema: object;
}

const define = (version: string, zod: z.ZodType<JobAnalysis>): OutputSchemaVersion => ({
  version,
  zod,
  jsonSchema: z.toJSONSchema(zod),
});

/**
 * Every released output schema, by version.
 *
 * A result is only meaningful relative to the contract it was produced
 * under, so old versions stay registered and are never edited. To change the
 * contract, add a new file and a new entry here, then move
 * CURRENT_OUTPUT_SCHEMA_VERSION.
 *
 * - 1.0.0: seniority is junior, mid or senior.
 * - 2.0.0: adds "unknown". Breaking for consumers, hence a major version.
 *
 * Output of every version must be assignable to the current JobAnalysis
 * type, which is why a new version should only widen what is allowed.
 */
const schemas: ReadonlyMap<string, OutputSchemaVersion> = new Map(
  [define("1.0.0", JobAnalysisSchemaV1), define("2.0.0", JobAnalysisSchemaV2)].map((s) => [
    s.version,
    s,
  ])
);

export const CURRENT_OUTPUT_SCHEMA_VERSION = "2.0.0";

export function getOutputSchema(
  version: string = CURRENT_OUTPUT_SCHEMA_VERSION
): OutputSchemaVersion {
  const schema = schemas.get(version);

  if (!schema) {
    const known = [...schemas.keys()].join(", ");
    throw new RangeError(`Unknown output schema version "${version}". Known versions: ${known}`);
  }

  return schema;
}
