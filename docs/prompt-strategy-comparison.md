# Zero-shot vs few-shot prompting

**Question:** does adding worked examples (few-shot) improve job analysis compared with no examples (zero-shot)?

**Short answer:** on these 9 cases, not for accuracy. Both strategies got seniority right every time they returned valid JSON. Few-shot was slightly *worse* at returning every required skill. Few-shot's real advantage is speed and output size, roughly 7x faster in the median. That is a cost advantage, not a quality one.

All numbers are from one run, saved in [`evals/results/strategy-comparison-2026-11-09T06-09-50-011Z.json`](../evals/results/strategy-comparison-2026-11-09T06-09-50-011Z.json). Reproduce with `npm run eval:strategies` (needs Ollama running).

## Setup

- **Model:** `gemma4` through Ollama, temperature 0.1, output limit 1500 tokens. **Prompt version:** 1.0.0.
- **Strategies:** identical system prompt and real input. Zero-shot sends no examples; few-shot adds 3 examples. A test checks that nothing else differs.
- **Cases:** 9 labelled job descriptions ([`evals/job-analysis.cases.ts`](../evals/job-analysis.cases.ts)): clear junior, mid and senior roles; senior implied by scope; a posting where the company context mentions unrelated technologies; a posting containing instructions aimed at the model; an ambiguous 2-4 year role; a one-line posting; and a long noisy posting. None of the case texts appear in the few-shot examples.
- **Runs:** each case x each strategy x 3 runs = 54 calls. Strategies alternate which goes first. A warm-up call (not recorded) loads the model first.
- **Infrastructure errors:** 0. Ollama crashes would be retried and kept out of the accuracy figures.

### How accuracy is measured

| Measure | Meaning |
|---|---|
| Seniority correct | The returned level is one of the acceptable levels for that case. Ambiguous cases accept more than one. |
| Recall | Fraction of the skills the job description clearly requires that the model returned. |
| Precision | Fraction of returned skills that are required or on a list of reasonable extras. |
| Forbidden skills | Runs that returned a skill that is *not* in the job description (the trap cases). |
| Valid JSON | The response parsed and passed the Zod schema. |

Skill matching is by whole word, so "Java" does not match "JavaScript" and "SQL" does not match "PostgreSQL". Interview topics and summaries are **not** scored, because that needs human judgment.

## Results

| | Zero-shot | Few-shot |
|---|---|---|
| Valid JSON | 25 / 27 | 26 / 27 |
| Seniority correct (of valid) | 25 / 25 | 26 / 26 |
| Mean recall | **1.00** | 0.93 |
| Mean precision | 0.97 (see note 2) | 1.00 |
| Runs with a forbidden skill | 0 | 0 |
| Runs missing a required skill | 0 | **6** |
| Duration, median | 9.4 s | **1.4 s** |
| Duration, mean | 10.5 s | **4.5 s** |
| Input tokens, mean | **338** | 598 |
| Output tokens, mean | 547 | **108** |

### What the results show

1. **No accuracy gain from examples on seniority or the traps.** Seniority was 100% for both, and neither strategy returned a forbidden skill. That includes the case with injected instructions and the case with misleading company context. The system prompt alone was enough to handle these, so examples had nothing to add. This is a ceiling effect: these cases were too easy to separate the strategies. It doesn't show that examples can never help.
2. **Few-shot lost some recall, and consistently.** All 6 runs with missing skills came from two cases, 3 out of 3 each time: `mid-backend` never returned "REST APIs", and `company-context-trap` never returned "prototyping". Because it repeated every time, this looks like a stable habit of the few-shot prompt, not random noise. The examples list short, tool-like skill names, and the model appears to copy that style. Note that "prototyping" is arguably less of a "technical skill" than "REST APIs", so the second miss is a weaker point than the first.
3. **Few-shot is much cheaper to run.** It uses about 260 more input tokens but about 440 fewer output tokens, and the median call is about 7x faster. Output tokens are the expensive part here.
4. **Output size differs in a way I can't fully explain.** Zero-shot returned about 650 characters of JSON but used 430-500 output tokens; few-shot returned about 240 characters in 45 tokens. That is far more tokens than the visible text needs. The response had no `thinking` field, so I can't say where the extra tokens go. I wrote earlier that thinking tokens were the likely cause; **that was a guess and I have no evidence for it.**

### Notes and problems with this experiment

1. **Small sample.** 9 cases and 3 runs each. A difference of one or two runs is not evidence. The recall gap rests on two cases.
2. **A scoring artifact favours few-shot slightly.** Zero-shot's precision of 0.97 comes from one answer, "User Flow Design", returned in all 3 runs of one case. The job description says "design user flows", so the answer is grounded. My matcher counted it as unexpected because "flows" and "flow" differ. Corrected, the precision is a tie at 1.00. I have **not** changed the scorer after seeing results, to avoid tuning the measurement to the outcome.
3. **Invalid JSON is unexplained.** There were 2 failures for zero-shot (both on `senior-frontend`) and 1 for few-shot. I could not reproduce them: 10 follow-up calls on those cases were all valid. A third zero-shot failure happened on the warm-up call. I can't say whether these are random, caused by memory pressure on this machine, or a real weakness. The runner now records the response length for such failures so the next run has more to go on.
4. **Timing is mixed with machine noise.** This laptop has about 4 GB of free RAM and Ollama has crashed here several times. I ran a type-check during the first few runs, which hit a memory error and probably slowed them. A few few-shot calls took 17-25 s, and some of those may be affected. Medians are more reliable than means.
5. **The labels are my own judgment** and I wrote the cases and the scorer. A reasonable reviewer might label some cases differently, especially the seniority boundaries.
6. **One model, one temperature, one prompt wording.** Results may differ with another model. The speed gain may come from the examples teaching the model to answer compactly, and a zero-shot prompt that explicitly asks for compact JSON might get most of it. I did not test that.

## What this means for the project

- **Don't assume few-shot is better.** Here it is faster and cheaper, with no measured accuracy benefit and some lost recall.
- **The code default is still few-shot.** I did not change it. If recall of every required skill matters most, the data favours zero-shot. If latency and cost matter most, it favours few-shot.
- **Suggested next steps:** (a) a larger and harder case set, since this one can't separate the strategies on seniority; (b) zero-shot plus a "compact JSON" instruction, to see whether examples are needed for the speed; (c) a few-shot example set that includes "REST APIs"-style skills, but not copied from the evaluation cases, to avoid training on the test.
