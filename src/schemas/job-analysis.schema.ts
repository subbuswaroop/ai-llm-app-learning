import { z } from "zod";

import {
  JobAnalysisSchemaV2,
  SeniorityLevelSchemaV2,
} from "./job-analysis.schema.v2";

/**
 * The CURRENT output contract, which the rest of the application codes
 * against. The definitions themselves live in frozen, versioned files
 * (job-analysis.schema.v1.ts, .v2.ts); this file only says which one is
 * current. When a new schema version is released, point these at it and
 * keep the old file untouched.
 */
export const SeniorityLevelSchema = SeniorityLevelSchemaV2;
export const JobAnalysisSchema = JobAnalysisSchemaV2;

/**
 * JSON Schema version of the current schema, generated from the Zod schema
 * so the two can never drift apart.
 *
 * Do not send this to a model directly: which JSON Schema a model gets
 * depends on the prompt bundle's schema version. Use the bundle's
 * `outputJsonSchema`.
 */
export const JobAnalysisJsonSchema = z.toJSONSchema(JobAnalysisSchema);

export type SeniorityLevel = z.infer<typeof SeniorityLevelSchema>;
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;
