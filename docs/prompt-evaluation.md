# Prompt evaluation and the "unknown" seniority level

## The problem

The schema forced `seniority` to be `junior`, `mid` or `senior`. For a posting that says nothing about the level, the model had to pick one anyway, and the made-up answer looks exactly like a real one to everything downstream.

## The change

Three prompt bundles are involved. A bundle is the prompt text, the examples and the output schema, released together (see the README, "Prompt bundles"):

| Bundle | Prompt | Output schema | Meaning |
|---|---|---|---|
| 1.0.0 | original | 1.0.0: junior, mid, senior | The original behaviour. The contract gives the model no way to say it does not know. |
| 1.0.1 | original text | 2.0.0: also allows unknown | "Just allow unknown in the schema." Evaluated and not adopted. |
| 1.1.0 | allows unknown, plus an example showing it | 2.0.0 | Current. |

1. **Schema 2.0.0:** `seniority` also accepts `"unknown"`, and the JSON Schema description sent to the model says to use it when there is no clear evidence and "Do not guess".
2. **Prompt 1.1.0:** the seniority rule now allows `"unknown"`. A test checks that 1.1.0 differs from 1.0.0 in exactly one line.
3. **A new few-shot example** (1.1.0 only) shows `unknown` together with an empty skills list.
4. **Older bundles are never changed.** Each bundle runs under its own schema, and the service validates a response under the schema version the provider reports, so an old prompt is not judged by a newer contract.

## Did it work? 1.0.0 vs 1.0.1 vs 1.1.0

Same two postings that give no evidence of a level (`missing-seniority`, `very-sparse`), both strategies, 3 runs each, each bundle under its own schema. Reproduce with `npm run eval:versions`; raw rows in [`evals/results/prompt-versions-latest.json`](../evals/results/prompt-versions-latest.json).

| Bundle | Strategy | Answered | Guessed a level | Said unknown |
|---|---|---|---|---|
| 1.0.0 (schema 1.0.0) | zero-shot | 6 | **6** | 0 |
| 1.0.0 (schema 1.0.0) | few-shot | 6 | **6** | 0 |
| 1.0.1 (schema 2.0.0, old prompt) | zero-shot | 6 | **6** | 0 |
| 1.0.1 (schema 2.0.0, old prompt) | few-shot | 6 | **6** | 0 |
| 1.1.0 (schema 2.0.0, new prompt) | zero-shot | 6 | **0** | 6 |
| 1.1.0 (schema 2.0.0, new prompt) | few-shot | 6 | **0** | 6 |

Things worth noting:

- **Allowing `unknown` in the schema was not enough.** Bundle 1.0.1 allows `unknown` in its schema, and the model never used it (12 of 12 guesses), because the prompt still told it to choose one of three. The prompt had to change too. Bundle 1.0.0 is not a fair test of this, because its schema does not allow `unknown` at all, so the model cannot say it.
- **The forced guesses were arbitrary.** For the one-line "knows Python" posting, 1.0.0 and 1.0.1 answered `junior` in some runs and `mid` in others. There was nothing in the text to base either on.
- **A correction to the first version of this experiment.** I first ran it before bundles existed, with "1.0.0" meaning the original prompt text under the new schema. That combination is now bundle 1.0.1, and re-running it with explicit bundles gave the same result (12 of 12 guesses). Bundle 1.0.0, under its real original schema, is the new third arm.

## Evaluation of prompt 1.1.0

7 cases, 3 runs per strategy, 42 real model calls, 0 Ollama failures. Run with `npm run test:live -- tests/prompt-eval.live.test.ts`. Report: [`evals/results/prompt-eval-latest.md`](../evals/results/prompt-eval-latest.md).

Cases: junior frontend developer, mid-level full-stack developer, senior React developer, missing seniority, malicious instructions (from the injection task), plus a one-line posting and a borderline 2-4 year role.

| | Zero-shot | Few-shot |
|---|---|---|
| Schema valid | 21/21 | 21/21 |
| Seniority correct | 21/21 | 21/21 |
| Skill precision | 1.00 | 1.00 |
| Skill recall | 1.00 | 1.00 |
| Runs with an unsupported claim | 0/21 | 0/21 |
| Guessed seniority | 0 | 0 |
| Over-abstained (said unknown where the level is clear) | 0 | 0 |

The pass/fail thresholds were fixed before the first run (mean recall >= 0.90, mean precision >= 0.90, at most 15% of runs with an unsupported claim, plus strict per-run checks on seniority, attack-text skills and invented numbers) and were all met.

### How each metric is measured

| Metric | Definition |
|---|---|
| Schema validity | The response parsed as JSON and passed the Zod schema. |
| Skill recall | Fraction of the skills the posting clearly requires that were returned. |
| Skill precision | Fraction of returned skills that are required or on a list of reasonable extras. |
| Seniority accuracy | The level is one of the acceptable levels for the case. `unknown` is correct only where the text gives no evidence. |
| Unsupported claims | Returned skills that are not in the labelled lists and whose words are not in the posting; skills copied from attack text; numbers in the summary or topics that the posting never states; a level picked where the case has no evidence. |
| Over-abstention | The model said `unknown` where the level is stated. Tracked separately, so a fix that makes the model refuse to answer would show up. |

## What this does not show

- **These cases are too easy to separate anything.** Everything scored 100%. A perfect result means the model handled these 7 cases, not that it is accurate in general. The harder, more realistic postings are where mistakes would appear.
- **The 3 runs are not 3 independent samples.** At temperature 0.1 the model is nearly deterministic: some cases gave the same response all 3 times. The effective sample is closer to 1-3 per case.
- **The metrics could be blind to some failures.** The guessed-seniority check is proven to work, because it caught all 12 guesses by prompt 1.0.0. The other unsupported-claim checks (ungrounded skills, invented numbers, attack-text skills) are unit-tested but **never fired on real model output**, so I have no evidence they would catch a real failure. They rely on a crude word stemmer. Vague claims in the summary ("modern web technologies") and interview topics are not measured at all.
- **The labels are my own judgment**, including that `unknown` is right for "Customer Portal Developer (remote)" and that "2-4 years" is junior or mid but never unknown.
- **One model, one temperature.** The `unknown` result is on the 2 no-evidence cases only.
- **Durations are not a finding.** Zero-shot's median was 28 s in this run against 9.4 s in the earlier comparison, on the same machine, so timing here is dominated by machine noise.
