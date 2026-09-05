# AI Model Evals

_Evaluated 2026-09-05 · Harness: `scripts/model-eval/` · Total run cost: $0.16_

Which AI models actually work for QuestCraft? We ran the game's real prompts
(the exact templates in `public/prompts/`) through six current models via
OpenRouter and scored the outputs with the same validators the game uses —
JSON extraction tiers, schema shape, board invariants, localization coverage,
and strategic correctness with known answers.

## Models under test

| Model | Why it's here |
| --- | --- |
| DeepSeek V3.2 | DeepSeek's current stable flagship |
| Gemma 4 31B | Newest Gemma generation |
| Gemma 3 27B | The Gemma already in our capability registry |
| GLM-5.3-Flash | Z.ai's fast/cheap tier |
| Qwen3.5 397B A17B | Qwen's current flagship |
| Gemini 2.5 Flash | The game's default — baseline for comparison |

Requests were sent exactly the way the game's OpenAI-compatible path sends
them: the `-openai` prompt variants, inline JSON schema, and
`response_format: { type: "json_object" }`.

## Task families

1. **Quest outline** (×2, one English-primary, one **Tamil-primary**) — the
   Maker flow. Full quest JSON: 20 locations, 3 resources, chance cards,
   footer sections, and `en/es/hi/ta` localization of every user-facing string.
2. **Dynamic scenario** (×1) — one scenario JSON with exactly two choices,
   localized, at a game location.
3. **AI player choice** (×3) — pick between two options where one is strictly
   dominant. Ground truth is known, so we can score strategy, not just format.
4. **In-game chat** (×2) — rules question + hint request against a real quest
   config. Scored on character, JSON-leak, and a ≤150-word brevity budget.

## Results

| Model | Quest JSON | Quest structure | 4-lang coverage | Scenario valid | Exactly 2 choices | Used `choiceIndex` | Strategy correct | Chat ≤150w | Quest p50 | Cost/quest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DeepSeek V3.2 | 2/2 | 0/2 | 0/2 | 0/1 | 0/1 | 0/3 | 1/3 | 1/2 | 283s | $0.0045 |
| Gemma 4 31B | 2/2 | 2/2 | 0/2 | 0/1 | 1/1 | 0/3 | 2/3 | 2/2 | 65s | $0.0021 |
| Gemma 3 27B | 2/2 | 0/2 | 0/2 | 0/1 | 1/1 | 0/3 | 3/3 | 1/2 | 246s | $0.0017 |
| GLM-5.3-Flash | 0/2 | 0/2 | 0/2 | 0/1 | 0/1 | 0/3 | 3/3 | 0/2 | 160s | $0.0042 |
| Qwen3.5 397B | 2/2 | 1/2 | 0/2 | 0/1 | 1/1 | 0/3 | 3/3 | 2/2 | 120s | $0.0253 |
| Gemini 2.5 Flash | 2/2 | 1/2 | 0/2 | 0/1 | 0/1 | 0/3 | 1/3 | 2/2 | 35s | $0.0186 |

Column notes:

- **Quest structure**: location count = 20, START at index 0, JAIL present with
  correct `jailPosition`, FREE_PARKING/GO_TO_JAIL present, 3 valid resources,
  chance cards referencing declared resources, Rules + About footers.
- **4-lang coverage**: every localized field carries all four requested
  languages. Nobody passes this — see Finding 3.
- **Strategy correct**: semantic answer score. The models were right 1–3 times
  out of 3 even though none of them answered in the format the game reads.

## Findings

### 1. The AI player is a coin flip today — for every model (critical)

The prompt (`prompts/ai-player-choice.txt`) asks for "a JSON object with the
index of your chosen option" but never names the keys. The game reads
`json.choiceIndex` (`services/aiService.ts`). Across **18 runs by 6 models,
zero used `choiceIndex`**. Observed keys: `choice`, `choice_index`,
`chosen_option`, `decision`, `index`, `option`. Every single run fell into
the "invalid choice index, picking randomly" path.

The models aren't the problem — on semantic scoring they chose the dominant
option 13/18 times (Gemma 3, GLM-5.3-Flash and Qwen3.5 went 3/3).
**Fix applied in this same release**: the prompt now specifies the exact JSON
contract, `{"choiceIndex": 0, "reasoning": "..."}`.

### 2. The OpenAI outline variant dropped the `groundingInReality` echo (fixed)

`quest-outline-system-openai.txt` is missing the line that tells the model to
echo the user's `groundingInReality` value (the base Gemini variant has it).
With only `response_format: json_object` — which cannot enforce booleans —
**all 12 outline runs returned `groundingInReality: true`** for fictional
quests, which would push scenario generation toward the grounded path.
**Fix applied**: the echo line has been restored to the OpenAI variant.

### 3. "All 4 languages in every field" is not achievable on a 20-location board

Every model, including Gemini, missed full `en/es/hi/ta` coverage somewhere —
typically one language skipped on a handful of the 20 locations (a 60+ field
localization task). All models produce real Tamil and Hindi script; the
Tamil-primary run did not increase misses. The game's
`getLocalizedString` fallback handles gaps gracefully, so this degrades
quality but doesn't break play. Treating 4/4 coverage as a pass/fail gate is
unrealistic; per-language coverage rate is the better metric (adopted in the
harness).

### 4. Choice-count drift

DeepSeek and Gemini produced 3 choices where the scenario prompt demands
"exactly two". Extra choices are silently ignored by the UI, but they skew
the AI player's option space and waste tokens. A explicit enumeration
("choices: [choiceA, choiceB]") may help; watch after the prompt fixes.

### 5. GLM-5.3-Flash ignores JSON mode on long generations

Both GLM outline runs returned free-form planning prose and terminated with
`finish_reason: "length"` — it spent the entire budget "thinking out loud"
instead of emitting JSON, even with `json_object` requested. Its choice and
scenario turns were fine. GLM on this path would need a higher token budget
or strict `json_schema` enforcement, and it is chatty in in-game chat
(~223 words average vs. the 150-word budget).

### 6. Latency is the real ranking signal for quest generation

Quest outlines are the heaviest call in the game, and the spread is enormous:
Gemini 35s → Gemma 4 65s → Qwen 120s → GLM 160s → Gemma 3 246s →
DeepSeek 283s (and a timeout on the first run). For interactive Maker flows
only Gemini and Gemma 4 are comfortable. Scenario and choice turns are fast
everywhere (1–14s).

## Suitability verdicts

| Model | Verdict |
| --- | --- |
| **Gemma 4 31B** | **Best all-rounder to add.** Only model with perfect board structure on both runs, fast (65s), cheapest quality option ($0.0021/quest), concise chat, 2/3 strategy. Recommend adding to `MODEL_CAPABILITIES` with `supportsMultiLanguage: true`. |
| **Qwen3.5 397B** | Strongest reasoner (3/3 strategy, 2/2 concise chat, good structure) but 3.4× slower and 12× pricier than Gemma 4. Best as a premium Maker option, not the default. |
| **Gemini 2.5 Flash** | Still the best interactive quest-gen UX (35s). Keep as default. |
| **DeepSeek V3.2** | Good JSON discipline but board-size drift (21–22 locations vs. 20 requested), 283s latency, and the most verbose chat (267-word run). Fine for choice turns (4s p50); not recommended for quest generation. |
| **Gemma 3 27B** | Superseded — slower, off-by-one `jailPosition`, 19 locations, verbose. If you keep one Gemma, make it Gemma 4. |
| **GLM-5.3-Flash** | Smart player (3/3) but cannot produce a quest outline over this path today. Re-evaluate with `json_schema` enforcement before adding to the registry. |

## Recommendations

1. ~~Fix the `choiceIndex` prompt contract~~ (**done**, see Finding 1).
2. ~~Restore the `groundingInReality` echo in the OpenAI outline variant~~ (**done**, Finding 2).
3. Add `MODEL_CAPABILITIES` entries for `google/gemma-4-31b-it` and `qwen/qwen3.5-397b-a17b`; consider replacing the `gemma-3-27b-it` entry.
4. Re-run GLM-5.3-Flash with strict JSON-schema enforcement before any registry decision.
5. Measure localization as per-language coverage instead of a 4/4 gate.
6. Consider a soft length cap ("Keep the reply under 120 words") on `chat-game.txt` — the three verbose models all blew the 150-word budget.

## Limitations

- Small n (2–3 samples per task per model) — this ranks tiers, not decimals.
- One provider path (OpenRouter, OpenAI-compatible). The Gemini-native path
  (structured `responseSchema`) is only exercised by the baseline.
- Prices are OpenRouter list prices on 2026-09-05; latency varies with load.
- Deterministic rubric only; narrative quality (fun, age-appropriateness) was
  spot-checked by reading outputs, not machine-scored.

## Reproduce

```bash
export OPENROUTER_API_KEY=...
bun scripts/model-eval/run2.ts        # runs all 48 tasks, writes results2.json
```

Full machine-readable outputs: `scripts/model-eval/results-2026-09-05.json`
(raw generations stripped) and `summary-2026-09-05.json`.
