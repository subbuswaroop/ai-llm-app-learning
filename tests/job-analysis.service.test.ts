import { describe, expect, it } from "vitest";
import {
  JobAnalysisService,
  JobAnalysisValidationError,
  MOCK_JOB_ANALYSIS,
} from "../src/services/job-analysis.service";

describe("JobAnalysisService", () => {
  it("returns the validated mock analysis", async () => {
    const service = new JobAnalysisService();

    await expect(service.analyze("Any job description")).resolves.toEqual(
      MOCK_JOB_ANALYSIS,
    );
  });

  it("rejects a response with an invalid seniority value", async () => {
    const service = new JobAnalysisService(async () => ({
      ...MOCK_JOB_ANALYSIS,
      seniority: "principal",
    }));

    const result = service.analyze("Any job description");

    await expect(result).rejects.toBeInstanceOf(JobAnalysisValidationError);
    await expect(result).rejects.toMatchObject({
      cause: { issues: [expect.objectContaining({ path: ["seniority"] })] },
    });
  });
});
