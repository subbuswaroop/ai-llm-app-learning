import { defineConfig } from "vitest/config";

// `npm run test:live`: calls the real model through Ollama.
// Slow, needs Ollama running, and results can vary between runs.
export default defineConfig({
  test: {
    include: ["tests/**/*.live.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // One request at a time: this machine's Ollama crashes under load.
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
