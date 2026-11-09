import { defineConfig } from "vitest/config";

// `npm test`: fast, deterministic, no Ollama needed.
// Tests that call a real model live in *.live.test.ts and run with `npm run test:live`.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.live.test.ts", "node_modules/**"],
  },
});
