# AI Recruitment Assistant

An AI-powered recruitment assistant built with TypeScript. It analyzes a job description and returns a structured summary: required skills, seniority level and suggested interview topics.

The LLM is currently mocked. Every response, mocked or real, is validated against a Zod schema before the rest of the app can use it.

## Project Structure

```
ai-recruitment-assistant/
├── src/
│   ├── api/        # HTTP routes / controllers
│   ├── services/   # Business logic (job-analysis.service.ts)
│   ├── schemas/    # Zod schemas (job-analysis.schema.ts)
│   ├── llm/        # LLM client and prompt logic
│   └── types/      # Shared TypeScript types
├── tests/          # Vitest tests
├── package.json
├── tsconfig.json
└── README.md
```

## Getting Started

Requires Node 26 or later (see `.nvmrc`).

```bash
npm install
npm test        # run the tests
npm run build   # compile to dist/
```

---

## Design Questions

### 1. Why should the LLM API call happen in the backend instead of React?

- **The API key stays secret.** Code in a React app is shipped to the browser, so anyone can read it in DevTools. If the key is in the frontend, anyone can use it and run up your bill.
- **The backend is the only part you control.** A user can edit requests in the browser, change the prompt or skip validation. On the server you decide which prompt is sent, which model is used and what is checked.
- **Rate limits and cost limits.** Per-user limits, quotas, caching and abuse protection only work if they run on the server.
- **One place to validate.** The backend checks the LLM output with Zod before it reaches any client, so every frontend receives data that has already been checked.
- **Easier to change later.** You can switch LLM provider, change a prompt or move to the real LLM in place of the mock without redeploying the frontend. React only sees a stable `/analyze`-style endpoint.
- **Logging.** The server can log prompts, responses and failures for debugging and audits.

### 2. Why do we need Zod if TypeScript already provides type checking?

TypeScript only checks your code at compile time. All types are removed when the code is compiled to JavaScript, so nothing checks the data while the app is running.

An LLM response comes from outside your code, at runtime. TypeScript can't know what the model will actually return. Writing `const result = JSON.parse(text) as JobAnalysis` only tells the compiler to trust you. If the model returns `seniority: "principal"`, misses a field or returns a string in place of an array, the bad data gets into the app and causes errors later.

Zod checks the actual data at runtime:

- `JobAnalysisSchema.safeParse(raw)` checks the real object and either returns typed data or reports exactly which fields are wrong.
- `z.infer<typeof JobAnalysisSchema>` creates the TypeScript type from the schema, so the runtime check and the compile-time type can't drift apart.
- The test `rejects a response with an invalid seniority value` shows this: TypeScript would accept the bad mock response, and Zod rejects it.

In short, TypeScript checks your own code, and Zod checks data you didn't write.

### 3. What happens if an LLM returns valid JSON with incorrect information?

**It passes validation.** Zod checks the shape of the data (types, required fields, allowed values), not whether it's true. `{ "seniority": "junior" }` is valid even when the job description asks for 10 years of experience. A skill the job never mentions, or a summary that describes the wrong role, will also pass.

This is the main risk with LLM output, and it needs more checks than a schema:

- **Business-rule checks after Zod.** Compare the output with the input. For example, check that each required skill actually appears in the job description, or flag "junior" when the text says "lead" or "8+ years".
- **Tighter schemas.** Narrow what the model can return: enums, length limits, non-empty arrays (`.min(1)`), and `.refine()` checks across fields.
- **Better prompts and settings.** Use clear instructions, examples, low temperature and the provider's structured-output or tool-calling mode.
- **Confidence and explanation.** Ask the model to quote the part of the text that supports each answer, so a person or code can check it.
- **Human review.** In recruitment, LLM output should help a recruiter, not make the decision. Show it as a suggestion that can be edited, never as the final word on a candidate.
- **Testing and monitoring.** Keep a set of known job descriptions with expected results. Run them whenever a prompt or model changes, and log real outputs to catch drift.

An incorrect but well-formed answer that nobody checks is worse than a crash, because it looks trustworthy. In hiring it can also introduce bias or unfairly filter out candidates.

### 4. Which parts of this architecture should remain deterministic?

Only the language understanding step, the LLM call, should be non-deterministic. Everything around it should be deterministic, so it can be tested and checked:

| Part | Why it must be deterministic |
|---|---|
| **Schema validation** (`src/schemas`) | The same input must always pass or always fail. This is the boundary that protects the app. |
| **Service logic** (`src/services`) | Parsing, error handling, retries and the rules for when to call the LLM must behave the same way every time. |
| **Business rules and decisions** | Scoring, filtering, ranking, accepting or rejecting candidates and anything with legal or fairness impact must use explicit rules you can audit. The LLM can suggest; it must not decide. |
| **Prompt construction** | Prompts are built from versioned templates, not generated on the fly, so the same input always produces the same request. |
| **API contracts** (`src/api`) | Request and response shapes, status codes and error formats stay fixed for clients. |
| **Auth, rate limits, logging, cost controls** | Security and limits must never depend on model output. |
| **Tests** (`tests/`) | Tests use mock providers (like `mockJobAnalysisProvider`) so they give the same result on every run, without network calls or model randomness. |

This is why the service takes a provider function as a parameter. The LLM is one replaceable, untrusted input, and everything after it is plain deterministic code.
