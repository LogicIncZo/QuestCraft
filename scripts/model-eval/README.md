# Model Eval Harness

Reproducible eval that runs QuestCraft's real prompt templates (`public/prompts/`) against
OpenRouter models and scores them deterministically — no LLM judge.

## What it measures

- **Parse tier** of every JSON task (direct / ```json fence / bracket-extraction / fail),
  mirroring `services/promptManager.ts` → `extractJson`.
- **Schema conformance** for quest outlines (board size, START/JAIL/`jailPosition`,
  FREE_PARKING/GO_TO_JAIL, 3 resources, Rules+About footers, positivity/grounding echo).
- **Localization coverage** per language (en/es/hi/ta), Tamil verified via Unicode script range.
- **AI-player choice correctness** against scenarios with a strictly dominant option, plus
  whether the model used the game-contract key `choiceIndex`.
- **Chat** conciseness (≤150 words), in-character check, JSON-leak detection.
- Latency (P50), token usage, and cost per call from OpenRouter usage + pricing metadata.

## Tasks per model

2× quest outline (en-primary + ta-primary) · 1× dynamic scenario · 3× player choice · 2× chat.

## Running

```bash
OPENROUTER_API_KEY=sk-or-... bun run run2.ts
```

Outputs `results2.json` (full transcripts + per-call scores) and `summary2.json`
(aggregated matrix). The dated `results-2026-09-05.json` / `summary-2026-09-05.json`
files are the snapshot behind `public/docs/model-evals.md`.

Edit `MODELS` in `run2.ts` to eval different models; edit `TASKS`/cases in `harness2.ts`
to change scenarios or validators.

## Cost

As of 2026-09-05 the 6-model × 9-call matrix costs roughly **$0.35 total**; only the
quest-outline calls are expensive (5–12K output tokens each).
