import { OllamaProvider } from "./llm/ollama.provider";
import { JobAnalysisService } from "./services/job-analysis.service";

async function main() {
  const service = new JobAnalysisService(new OllamaProvider());

  const jobDescription = `
    We are looking for a Senior Frontend Engineer.

    Requirements:
    - 7+ years of experience.
    - Strong React and TypeScript skills.
    - Experience with Next.js.
    - Knowledge of frontend architecture.
    - Experience optimizing application performance.
  `;

  const result = await service.analyze(jobDescription);

  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
