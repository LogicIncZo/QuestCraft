import OpenAI from 'openai';
import type { z } from 'zod';
import { type ApiAction, actionPayloadSchemas } from '../shared/actions';
import { type PromptTemplateName, fillPromptTemplate } from '../shared/prompts';
import type { Stream } from 'openai/streaming';

export const config = {
    runtime: 'edge',
};

// --- Custom stream helpers to replace removed 'ai' package exports ---

/**
 * A re-implementation of the Vercel AI SDK's OpenAIStream to convert the
 * OpenAI SDK's response stream into a format suitable for StreamingTextResponse.
 * @param res The stream from the OpenAI API response.
 * @returns A ReadableStream of Uint8Array encoded text chunks.
 */
function OpenAIStream(
    res: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        async start(controller) {
            for await (const chunk of res) {
                const text = chunk.choices[0]?.delta?.content;
                if (text) {
                    controller.enqueue(encoder.encode(text));
                }
            }
            controller.close();
        },
    });
}

/**
 * A re-implementation of the Vercel AI SDK's StreamingTextResponse to create a
 * streaming Response object with appropriate headers for text streaming.
 */
class StreamingTextResponse extends Response {
    constructor(stream: ReadableStream, init?: ResponseInit) {
        super(stream, {
            ...init,
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                ...init?.headers,
            },
        });
    }
}

// --- Model Configuration ---
// Community gateway chain: free models with per-request fallback plus a
// health ledger (below) so a failing entry is skipped for a cooldown window
// instead of taxing every request with its failure latency.
//
// Ordering note: entry 2 (nex-n2.5-pro) is deliberately NOT an NVIDIA model.
// Every other entry - the OpenRouter nemotrons (routed to NVIDIA upstream)
// and the NIM direct entry - ultimately depends on NVIDIA capacity. During
// the 2026-09-23 NVIDIA overload all four NVIDIA-backed entries failed at
// once; a non-NVIDIA entry early in the chain keeps the gateway alive when
// that happens. Verified live that day (json_object, ~1s).
//
// Entries verified live 2026-09-23 (1-token json_object probe):
//   ultra (200), nex-pro (200); super / nano-omni-OR / nano-omni-NIM hit
//   transient capacity errors with retryable semantics (still registered).
// Probed and REJECTED 2026-09-23:
//   - deepseek-ai/deepseek-v4-flash-0731 (NIM): 410 Gone - retired.
//   - deepseek-ai/deepseek-v4.1-flash (NIM): listed but hangs >45s.
//   - google/gemma-4-31b-it:free (OpenRouter): 504 upstream abort.
type CommunityModelEntry = { model: string; client: 'openrouter' | 'nim' };
export const COMMUNITY_MODELS: CommunityModelEntry[] = [
    { model: 'nvidia/nemotron-3-ultra-550b-a55b:free', client: 'openrouter' },
    { model: 'nex-agi/nex-n2.5-pro:free', client: 'openrouter' },
    { model: 'nvidia/nemotron-3-super-120b-a12b:free', client: 'openrouter' },
    { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', client: 'openrouter' },
    { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', client: 'nim' },
];
// Display-only default (first chain entry) — the server may serve any chain entry.
const COMMUNITY_MODEL = COMMUNITY_MODELS[0].model;

const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

interface CommunityClients {
    openrouter?: OpenAI;
    nim?: OpenAI;
}

function getCommunityClients(): CommunityClients {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const nimKey = process.env.NVIDIA_API_KEY;
    if (!openrouterKey && !nimKey) {
        throw new Error(
            'No community gateway provider keys configured (OPENROUTER_API_KEY / NVIDIA_API_KEY).'
        );
    }
    const openrouter = openrouterKey
        ? new OpenAI({
              baseURL: 'https://openrouter.ai/api/v1',
              apiKey: openrouterKey,
              defaultHeaders: {
                  'HTTP-Referer': 'https://questcraft.ai',
                  'X-Title': 'QuestCraft',
              },
          })
        : undefined;
    const nim = nimKey
        ? new OpenAI({
              baseURL: NIM_BASE_URL,
              apiKey: nimKey,
          })
        : undefined;
    return { openrouter, nim };
}

// --- Health ledger (per edge isolate) ---
// Tracks consecutive failures per model so a dead or overloaded entry is
// skipped for a cooldown window instead of being retried on every request.
// State is per-isolate: correctness never depends on it (the full chain is
// still walked when everything is cooling); it only keeps known-bad entries
// out of the front of the line.
interface ModelHealth {
    consecutiveFails: number;
    lastFailAt: number;
    openUntil: number;
}
const healthLedger = new Map<string, ModelHealth>();
const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_MAX_MS = 10 * 60_000;

function cooldownFor(consecutiveFails: number): number {
    // 30s, 1m, 2m, 4m, 8m, then capped at 10m.
    return Math.min(COOLDOWN_BASE_MS * 2 ** (consecutiveFails - 1), COOLDOWN_MAX_MS);
}

function recordFailure(model: string): void {
    const prev = healthLedger.get(model);
    const consecutiveFails = (prev?.consecutiveFails ?? 0) + 1;
    const now = Date.now();
    healthLedger.set(model, {
        consecutiveFails,
        lastFailAt: now,
        openUntil: now + cooldownFor(consecutiveFails),
    });
    console.warn(
        `[community-gateway] ${model} failed (${consecutiveFails} consecutive); cooling down ${Math.round(cooldownFor(consecutiveFails) / 1000)}s`
    );
}

function recordSuccess(model: string): void {
    healthLedger.delete(model);
}

function isCooling(model: string, now = Date.now()): boolean {
    const h = healthLedger.get(model);
    return !!h && h.openUntil > now;
}

/** Test hook: clear all health state between test cases. */
export function __resetGatewayHealth(): void {
    healthLedger.clear();
}

/**
 * Chain order for one request: healthy entries first (config order - the
 * quality ranking), then cooling entries ordered by soonest recovery as a
 * best-effort last resort. Availability beats purity when every entry is
 * cooling: trying a maybe-recovered model beats failing hard.
 */
function orderedChain(now = Date.now()): CommunityModelEntry[] {
    const healthy = COMMUNITY_MODELS.filter((e) => !isCooling(e.model, now));
    const cooling = COMMUNITY_MODELS.filter((e) => isCooling(e.model, now)).sort(
        (a, b) =>
            (healthLedger.get(a.model)?.openUntil ?? 0) -
            (healthLedger.get(b.model)?.openUntil ?? 0)
    );
    return [...healthy, ...cooling];
}

/**
 * Wraps a partially-consumed stream: yields the already-peeked first chunk,
 * then the rest of the original stream unchanged.
 */
async function* guardedStream(first: IteratorResult<any>, rest: AsyncIterator<any>) {
    yield first.value;
    while (true) {
        const next = await rest.next();
        if (next.done) break;
        yield next.value;
    }
}

const SDK_HEADERS_TIMEOUT_MS = 8_000; // time to response headers only
const FIRST_CHUNK_TIMEOUT_MS = 10_000; // headers may arrive, body must speak
const CHAIN_TOTAL_BUDGET_MS = 40_000; // whole walk; Vercel edge kills past ~45s
const MIN_ENTRY_BUDGET_MS = 6_000; // don't start an entry we can't guard
const SDK_MAX_RETRIES = 0; // we run our own failover - SDK retries would delay it

// --- Jev decision layer (TypeSafe System One, via the OpenRouter Decisions API) ---
// Jev returns typed decisions, not prose, so it never joins the generation chain.
// Same OpenRouter key as the chain; output tokens are free. Wire format
// live-probed 2026-09-24: { model, state, questions } -> { answers, usage }.
const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const JEV_TIMEOUT_MS = 10_000;

function rejectAfter(ms: number): Promise<never> {
    return new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
        (t as any)?.unref?.();
    });
}

/**
 * Runs a community-tier completion against the best available model in the
 * chain. Resilience layers, in order:
 *   1. Health ledger - cooling entries are skipped (see orderedChain).
 *   2. Per-request SDK options - maxRetries: 0 and a hard timeout, so one
 *      hung model cannot eat the function budget before failover.
 *   3. Soft-fail detection - OpenRouter can return HTTP 200 with an
 *      {error: ...} body (observed live 2026-09-23 during NVIDIA overload).
 *      The SDK does not throw on a 200, so both the non-stream response and
 *      the peeked first stream chunk are inspected for an error object.
 *   4. Streaming errors surface on iteration, not at create() - the first
 *      chunk is peeked so upstream failures (429/502, model pulled) trigger
 *      the fallback instead of blowing up in the caller after we have
 *      returned a doomed stream. A stream that dies after the first chunk is
 *      not recoverable here (bytes may already be flushed) and is accepted
 *      as the boundary of server-side failover; only chat streams.
 * Each failure records a cooldown; each success resets the entry's health.
 */
async function communityCompletion(
    clients: CommunityClients,
    params: { messages: any[]; [key: string]: any }
): Promise<any> {
    let lastError: unknown;
    const deadline = Date.now() + CHAIN_TOTAL_BUDGET_MS;
    for (const entry of orderedChain()) {
        const client = entry.client === 'nim' ? clients.nim : clients.openrouter;
        if (!client) continue; // provider key not configured -> skip entries
        const remaining = deadline - Date.now();
        // Out of platform-safe budget: fail clean (500 + ledger-cooled models)
        // instead of letting the edge runtime kill the function mid-walk.
        if (remaining < MIN_ENTRY_BUDGET_MS) break;
        const entryBudget = Math.min(FIRST_CHUNK_TIMEOUT_MS, remaining);
        try {
            const stream = await client.chat.completions.create(
                {
                    ...(params as any),
                    stream: true,
                    model: entry.model,
                },
                { timeout: Math.min(SDK_HEADERS_TIMEOUT_MS, remaining), maxRetries: SDK_MAX_RETRIES }
            );
            const iterator = (stream as any)[Symbol.asyncIterator]();
            const first = await Promise.race([
                iterator.next(),
                rejectAfter(entryBudget),
            ]);
            if (first.done) {
                throw new Error(`${entry.model} returned an empty stream`);
            }
            if (
                first.value &&
                typeof first.value === 'object' &&
                'error' in first.value
            ) {
                throw new Error(
                    `${entry.model} soft-failed: ${JSON.stringify(first.value.error).slice(0, 300)}`
                );
            }
            recordSuccess(entry.model);
            return guardedStream(first, iterator);
        } catch (error) {
            lastError = error;
            recordFailure(entry.model);
            console.warn(
                `[community-gateway] ${entry.model} failed: ${(error as Error).message}; trying next model`
            );
        }
    }
    throw lastError ?? new Error('No community gateway models are configured.');
}

/**
 * Cheap ops surface for the gateway: which providers are configured and the
 * live health of every chain entry. No upstream calls, no token spend.
 */
async function handleJevEvaluate(
    payload: any,
    origin: string | null,
    req: Request
): Promise<Response> {
    const fail = (status: number, message: string) =>
        new Response(JSON.stringify({ error: { message } }), {
            status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, req) },
        });

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return fail(503, 'Decision layer is not configured.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
    try {
        const upstream = await fetch(JEV_DECISIONS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: JEV_MODEL,
                state: payload.state,
                questions: payload.questions,
            }),
            signal: controller.signal,
        });
        if (!upstream.ok) {
            console.error(`Jev upstream HTTP ${upstream.status}`);
            return fail(502, 'Decision layer is temporarily unavailable.');
        }
        const data: any = await upstream.json();
        if (data && typeof data === 'object' && data.error) {
            console.error('Jev upstream soft error');
            return fail(502, 'Decision layer is temporarily unavailable.');
        }
        return new Response(
            JSON.stringify({ answers: data?.answers ?? {}, usage: data?.usage ?? null }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, req) },
            }
        );
    } catch (e: any) {
        console.error('Jev call failed:', e?.message);
        return fail(502, 'Decision layer is temporarily unavailable.');
    } finally {
        clearTimeout(timer);
    }
}

function handleGatewayStatus(origin: string | null, req: Request): Response {
    const now = Date.now();
    const chain = COMMUNITY_MODELS.map((e) => {
        const h = healthLedger.get(e.model);
        const cooldownMs = h ? Math.max(0, h.openUntil - now) : 0;
        return {
            model: e.model,
            client: e.client,
            status: cooldownMs > 0 ? 'cooling' : 'healthy',
            consecutiveFails: h?.consecutiveFails ?? 0,
            cooldownMs: cooldownMs > 0 ? cooldownMs : undefined,
        };
    });
    return new Response(
        JSON.stringify({
            providers: {
                openrouter: !!process.env.OPENROUTER_API_KEY,
                nim: !!process.env.NVIDIA_API_KEY,
                jev: !!process.env.OPENROUTER_API_KEY,
            },
            chain,
            timestamp: new Date().toISOString(),
        }),
        {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders(origin, req),
            },
        }
    );
}

// --- Schemas for OpenAI-compatible models ---
const localizedStringSchema = {
    type: 'object',
    properties: {
        en: { type: 'string' },
        es: { type: 'string' },
        hi: { type: 'string' },
        ta: { type: 'string' },
    },
};

const resourceChangeSchema = {
    type: 'object',
    properties: {
        name: { type: 'string', description: 'The lowercase English name of the resource.' },
        value: { type: 'number' },
    },
    required: ['name', 'value'],
};

const choiceOutcomeSchema = {
    type: 'object',
    properties: {
        explanation: localizedStringSchema,
        resourceChanges: { type: 'array', items: resourceChangeSchema },
    },
    required: ['explanation', 'resourceChanges'],
};

const choiceSchema = {
    type: 'object',
    properties: {
        text: localizedStringSchema,
        outcome: choiceOutcomeSchema,
    },
    required: ['text', 'outcome'],
};

const scenarioSchema = {
    type: 'object',
    properties: {
        title: localizedStringSchema,
        description: localizedStringSchema,
        choices: { type: 'array', items: choiceSchema, minItems: 2, maxItems: 2 },
        sourceUrl: { type: 'string' },
        sourceTitle: localizedStringSchema,
    },
    required: ['title', 'description', 'choices'],
};

const scenarioArraySchemaForOpenAI = {
    type: 'object',
    properties: {
        scenarios: { type: 'array', items: scenarioSchema },
    },
    required: ['scenarios'],
};

const resourceDefinitionSchema = {
    type: 'object',
    properties: {
        name: localizedStringSchema,
        icon: { type: 'string', enum: ['MoneyIcon', 'TimeIcon', 'InfoIcon'] },
        barColor: { type: 'string' },
        initialValue: { type: 'number' },
        minimumValue: { type: 'number' },
        maximumValue: { type: 'number' },
    },
    required: ['name', 'icon', 'barColor', 'initialValue'],
};

const boardLocationSchema = {
    type: 'object',
    properties: {
        name: localizedStringSchema,
        description: localizedStringSchema,
        type: {
            type: 'string',
            enum: [
                'START',
                'PROPERTY',
                'CHANCE',
                'COMMUNITY_CHEST',
                'UTILITY',
                'TAX',
                'JAIL',
                'FREE_PARKING',
                'GO_TO_JAIL',
            ],
        },
        color: { type: 'string' },
    },
    required: ['name', 'description', 'type'],
};

const chanceCardSchema = {
    type: 'object',
    properties: {
        description: localizedStringSchema,
        resourceChanges: { type: 'array', items: resourceChangeSchema },
    },
    required: ['description', 'resourceChanges'],
};

const footerSectionSchema = {
    type: 'object',
    properties: {
        title: localizedStringSchema,
        content: localizedStringSchema,
    },
    required: ['title', 'content'],
};

const questConfigSchemaForOpenAI = {
    type: 'object',
    properties: {
        name: localizedStringSchema,
        description: localizedStringSchema,
        positivity: { type: 'number' },
        resources: { type: 'array', items: resourceDefinitionSchema },
        playerColors: { type: 'array', items: { type: 'string' } },
        board: {
            type: 'object',
            properties: {
                jailPosition: { type: 'number' },
                locations: { type: 'array', items: boardLocationSchema },
            },
            required: ['jailPosition', 'locations'],
        },
        chanceCards: { type: 'array', items: chanceCardSchema },
        communityChestCards: { type: 'array', items: chanceCardSchema },
        footerSections: { type: 'array', items: footerSectionSchema },
    },
    required: [
        'name',
        'description',
        'resources',
        'playerColors',
        'board',
        'chanceCards',
        'footerSections',
    ],
};

// --- Prompts are now embedded to support Vercel Edge runtime ---
const promptTemplates: Record<PromptTemplateName, string> = {
    'enhance-idea.txt': `You are an expert game designer and prompt engineer specializing in educational board games.

Your task is to take the user's simple idea below and enhance it into a more detailed and evocative prompt that will help an AI game designer generate a rich and thematic quest.

**Original User Idea to Enhance:**
"{idea}"

**Your Instructions:**
1.  **Do not generate JSON.** Your output must be a single block of enhanced text.
2.  **Retain the Core Concept:** Keep the user's original theme and subject matter at the heart of the new prompt.
3.  **Target Audience:** The enhanced prompt must be tailored for the following target age group: **{ageGroup}**. Ensure the complexity, tone, and subject matter are appropriate.
4.  **Suggest Core Resources:** Propose three thematic resources that players will manage. For example, for a freelance artist game, you might suggest "Money", "Creativity", and "Well-being".
5.  **Add Thematic Details:** Flesh out the idea with specific concepts, potential challenges, and flavourful names for locations or cards.
6.  **Write as a Prompt:** Frame your response as a direct, enhanced instruction for another AI. It should be creative, descriptive, and inspiring.

**For context, here is an example of a good enhancement:**
If the original user idea was "A game about the challenges of being a freelance artist", your enhanced prompt might look like:

"Create a game about the life of a freelance artist navigating the gig economy. Players must balance three key resources: **Money** for bills and supplies, **Creativity** to produce high-quality work, and **Well-being** to avoid burnout. The board should feature locations like 'Client Pitch Meeting', 'Inspiration Slump', 'Art Supply Store', and 'Networking Event'. Chance cards could represent unexpected commissions or creative blocks. The overall tone should be a realistic but hopeful look at the freelance journey."`,

    'quest-outline-system-openai.txt': `You are a creative game designer specializing in educational board games. Your task is to generate a complete configuration for a Monopoly-style game based on a user's idea. The output must be a valid JSON object that adheres to the schema provided below.

**LANGUAGE INSTRUCTIONS:**
- The primary language for this quest is {languageName} ({languageCode}).
- For ALL user-facing text fields (e.g., \`name\`, \`description\`, \`resources.name\`, \`locations.name\`, \`locations.description\`, \`chanceCards.description\`, \`footerSections.title\`, \`footerSections.content\`), you MUST generate a JSON object containing translations for the following languages: {languageList}.
- The translation for the primary language ({languageCode}) should be the most detailed and thematic. The other translations should be accurate and make sense.

Example of a localized text field:
"name": {
  "en": "Quest Name",
  "es": "Nombre de la Misión",
  "hi": "क्वेस्ट का नाम",
  "ta": "குவெஸ்ட் பெயர்"
}

Key Instructions:
- Create exactly 3 resources. For each resource, also generate a \`minimumValue\` (e.g., 0) and a \`maximumValue\` (e.g., double the initialValue).
- Create a game board with exactly {numLocations} locations. One of these must be 'START' at index 0, 'JAIL' at some index, 'FREE_PARKING', and 'GO_TO_JAIL'. The board should be balanced for this number of locations.
- The user has specified a 'positivity' level of {positivity} (from 0.0=dystopian to 1.0=optimistic). Use this to influence the tone of names, descriptions, and cards, and set the 'positivity' field in the output to the same value.
- The 'jailPosition' must correctly point to the index of the 'JAIL' location.
- Resource names in 'resourceChanges' objects must be the lowercase English name of the resource.
- Fill all fields creatively and thematically based on the user's idea.
- Provide content for two footer sections: one titled "Rules" and one titled "About".
- The game should be balanced and playable.
- Your entire response MUST be a single JSON object. Do not include any text outside of the JSON.

JSON Schema:
{schema}`,

    'pregenerated-scenarios-fictional-openai.txt': `You are a creative game master specializing in engaging, educational scenarios.

# Game Context
- **Quest Theme:** {questDescription}
- **Location:** {locationName}
- **Location Description:** {locationDescription}
- **Player Resources:** {resourceNames}

# Your Task
Your task is to generate {numScenarios} unique, fictional scenarios for this location.
Focus on creating engaging, educational, and family-friendly content. Avoid sensitive, controversial, or political topics.

# LANGUAGE INSTRUCTIONS:
- All user-facing text in the scenarios (\`title\`, \`description\`, \`choices.text\`, \`outcome.explanation\`) MUST be a JSON object with translations for the following languages: {languageList}.
- The primary language for the response should be {languageName} ({languageCode}).
- Your entire response MUST be a single JSON object with a single root key "scenarios" containing an array of the {numScenarios} generated scenario objects. The response must adhere to the schema provided below. Do not include any text outside of the JSON.

# JSON Schema
{schema}`,
    'dynamic-scenario-fictional-openai.txt': `You are a creative game master specializing in engaging, educational scenarios.

# Game Context
- **Quest Theme:** {questDescription}
- **Location:** {locationName}
- **Location Description:** {locationDescription}
- **Player Resources:** {resourceNames}

# Your Task
Your task is to generate ONE fictional scenario for this location.
Focus on creating engaging, educational, and family-friendly content. Avoid sensitive, controversial, or political topics.

# LANGUAGE INSTRUCTIONS:
- All user-facing text in the scenario (\`title\`, \`description\`, \`choices.text\`, \`outcome.explanation\`) MUST be a JSON object with translations for the following languages: {languageList}.
- The primary language for the response should be {languageName} ({languageCode}).
- Your entire response MUST be a single JSON object that adheres to the schema provided below. Do not include any text outside of the JSON.

# JSON Schema
{schema}`,
    'random-idea.txt': `You are an expert creative game designer specializing in educational and thematic board games related to real world.

Your task is to generate a single, unique and random idea for a board game based on current affairs  / personas / cities / states / countries / issues of global significance and relatability across age groups.

**Instructions:**
1.  The output MUST be a single, concise paragraph.
2.  The idea must be suitable for a Monopoly-style board game.
3.  The idea must be appropriate for the following target age group: **{ageGroup}**.
4.  The paragraph must clearly describe:
    - An engaging and specific theme (e.g., managing a city's public transit system, navigating the challenges of scientific research, building a sustainable coral reef).
    - Three thematic resources that players would manage. Explicitly name them in the format: **Resource 1**, **Resource 2**, and **Resource 3**.

**Example Output:**
"A game about restoring a polluted river ecosystem. Players must balance three key resources: **Funding** for cleanup projects, **Biodiversity** to bring back native species, and **Public Awareness** to gain community support. The board could feature locations like 'Industrial Waste Outlet', 'Community Volunteer Day', and 'Protected Wetland Reserve'. The goal is to be the first to achieve a fully restored and thriving river."`,
};

function loadPrompt(
    fileName: keyof typeof promptTemplates,
    replacements: Record<string, any> = {}
): string {
    const template = promptTemplates[fileName];
    if (!template) {
        const errorMsg = `Error: Could not load prompt template ${fileName}. Template not found.`;
        console.error(errorMsg);
        return errorMsg;
    }
    return fillPromptTemplate(template, replacements);
}

// --- Security hardening (issue #56) ---

const DEFAULT_ALLOWED_ORIGINS = [
    // Current production URL (fork deploy). aipoly.vercel.app is a dead
    // third-party name collision - removed 2026-09-23.
    'https://questcraft-srikanthlogics-projects.vercel.app',
    'https://quest-craft.vercel.app',
    'https://questcraft-dusky.vercel.app',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
];

const getAllowedOrigins = (): string[] => {
    const extra = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    return [...DEFAULT_ALLOWED_ORIGINS, ...extra];
};

const isAllowedOrigin = (origin: string | null, req?: Request): boolean => {
    if (!origin) return true; // non-browser clients (curl, server-to-server)
    if (req) {
        // Same-origin requests: the Origin host equals the serving host
        try {
            const host = new URL(req.url).host;
            if (new URL(origin).host === host) return true;
        } catch {
            // malformed origin falls through to the allowlist
        }
    }
    return getAllowedOrigins().includes(origin);
};

const corsHeaders = (origin: string | null, req?: Request): Record<string, string> => ({
    'Access-Control-Allow-Origin': isAllowedOrigin(origin, req) && origin ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
});

const MAX_CHAT_HISTORY_MESSAGES = 40;
const MAX_CHAT_MESSAGE_CHARS = 8_000;
const MAX_CHAT_HISTORY_CHARS = 32_000;

const LANGUAGE_MAP: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    hi: 'Hindi',
    ta: 'Tamil',
};

const getAgeGroupText = (ageGroupKey: string): string => {
    switch (ageGroupKey) {
        case 'kids':
            return 'Kids (5-8)';
        case 'pre-teens':
            return 'Pre-Teens (9-12)';
        case 'teens':
            return 'Teens (13-17)';
        case 'adults':
            return 'Adults (18+)';
        default:
            return 'Any Age';
    }
};

// --- Action Handlers ---

async function handleTestConnection(clients: CommunityClients) {
    const stream = await communityCompletion(clients, {
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
    });
    // Drain the guarded stream: an unconsumed body would dangle and can hold
    // the edge function alive until the platform kills it.
    const iterator = (stream as any)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    return new Response('Connection successful', { status: 200 });
}

async function handleEnhanceQuestIdea(clients: CommunityClients, payload: any) {
    const { idea, ageGroup } = payload;
    const prompt = loadPrompt('enhance-idea.txt', { idea, ageGroup: getAgeGroupText(ageGroup) });
    const response = await communityCompletion(clients, {
        messages: [{ role: 'user', content: prompt }],
        stream: true,
    });
    const stream = OpenAIStream(response);
    return new StreamingTextResponse(stream);
}

async function handleGenerateRandomQuestIdea(clients: CommunityClients, payload: any) {
    const { ageGroup } = payload;
    const prompt = loadPrompt('random-idea.txt', { ageGroup: getAgeGroupText(ageGroup) });
    const response = await communityCompletion(clients, {
        messages: [{ role: 'user', content: prompt }],
        stream: true,
    });
    const stream = OpenAIStream(response);
    return new StreamingTextResponse(stream);
}

async function handleGenerateQuestOutline(clients: CommunityClients, payload: any) {
    const { idea, numLocations, positivity, supportedLanguages, languageCode } = payload;
    const languageName = LANGUAGE_MAP[languageCode] || 'English';
    const languageList = (supportedLanguages.length > 0 ? supportedLanguages : ['en'])
        .map((code: string) => `${LANGUAGE_MAP[code]} ('${code}')`)
        .join(', ');

    const prompt = `Generate a quest based on this idea: "${idea}"`;
    const schemaString = JSON.stringify(questConfigSchemaForOpenAI, null, 2);
    const systemPrompt = loadPrompt('quest-outline-system-openai.txt', {
        numLocations,
        positivity,
        groundingInReality: false, // "Ground in Reality" is disabled for community tier
        languageCode,
        languageName,
        languageList,
        schema: schemaString,
    });

    const response = await communityCompletion(clients, {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        stream: true,
    });
    const stream = OpenAIStream(response);
    return new StreamingTextResponse(stream);
}

async function handleGenerateScenarios(clients: CommunityClients, payload: any, action: string) {
    const { questConfig, location, numScenarios, languageCode } = payload;
    const isDynamic = action === 'generateDynamicScenario';

    const languageName = LANGUAGE_MAP[languageCode] || 'English';
    const resourceNames = questConfig.resources.map((r: any) => r.name.en.toLowerCase()).join(', ');
    const languageList = (questConfig.supportedLanguages || ['en'])
        .map((code: string) => `${LANGUAGE_MAP[code]} ('${code}')`)
        .join(', ');

    const replacements = {
        questDescription: questConfig.description.en,
        locationName: location.name.en,
        locationDescription: location.description.en,
        resourceNames,
        numScenarios: isDynamic ? 1 : numScenarios,
        languageCode,
        languageName,
        languageList,
    };

    const promptFileKey = isDynamic
        ? 'dynamic-scenario-fictional-openai.txt'
        : 'pregenerated-scenarios-fictional-openai.txt';
    const schema = isDynamic ? scenarioSchema : scenarioArraySchemaForOpenAI;
    const schemaString = JSON.stringify(schema, null, 2);
    const systemPrompt = loadPrompt(promptFileKey, { ...replacements, schema: schemaString });

    const response = await communityCompletion(clients, {
        messages: [{ role: 'system', content: systemPrompt }],
        response_format: { type: 'json_object' },
        stream: true,
    });

    const stream = OpenAIStream(response);
    return new StreamingTextResponse(stream);
}

async function handleChat(clients: CommunityClients, payload: any) {
    const { message, history, systemInstruction } = payload;
    const userMessage = String(message ?? '').slice(0, MAX_CHAT_MESSAGE_CHARS);

    const validHistory = Array.isArray(history)
        ? history.filter(
              (m: any) =>
                  m && (m.role === 'user' || m.role === 'model') && typeof m.content === 'string'
          )
        : [];

    // Server-side caps: keep the most recent messages within count + char budgets.
    const kept: { role: string; content: string }[] = [];
    let totalChars = 0;
    for (let i = validHistory.length - 1; i >= 0; i--) {
        const m = validHistory[i];
        if (
            kept.length >= MAX_CHAT_HISTORY_MESSAGES ||
            totalChars + m.content.length > MAX_CHAT_HISTORY_CHARS
        )
            break;
        totalChars += m.content.length;
        kept.unshift({ role: m.role, content: m.content.slice(0, MAX_CHAT_MESSAGE_CHARS) });
    }

    const messages = [
        {
            role: 'system',
            content:
                typeof systemInstruction === 'string'
                    ? systemInstruction.slice(0, MAX_CHAT_MESSAGE_CHARS * 2)
                    : '',
        },
        ...kept,
        { role: 'user', content: userMessage },
    ];

    const response = await communityCompletion(clients, {
        stream: true,
        messages: messages as any,
    });

    const stream = OpenAIStream(response);
    return new StreamingTextResponse(stream);
}

// --- Main Handler ---

export default async function handler(req: Request) {
    const origin = req.headers.get('origin');

    if (req.method === 'OPTIONS') {
        if (!isAllowedOrigin(origin)) {
            return new Response('Forbidden', { status: 403 });
        }
        return new Response(null, {
            status: 204,
            headers: {
                ...corsHeaders(origin, req),
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    if (!isAllowedOrigin(origin)) {
        return new Response('Forbidden', { status: 403 });
    }

    let body: { action?: string; payload?: any };
    try {
        body = await req.json();
    } catch {
        return new Response('Malformed JSON body.', { status: 400, headers: corsHeaders(origin, req) });
    }

    const action = body?.action as ApiAction;
    const rawPayload = body?.payload;
    const payloadSchema = actionPayloadSchemas[action];
    if (!payloadSchema) {
        return new Response(`Unknown action: ${String(action)}`, {
            status: 400,
            headers: corsHeaders(origin, req),
        });
    }
    const parsed = payloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
        return new Response(
            `Invalid payload for action '${String(action)}': ${parsed.error.issues.map((i: z.ZodIssue) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`,
            { status: 400, headers: corsHeaders(origin, req) }
        );
    }

    const payload = parsed.data;

    // gatewayStatus is an ops surface: it must answer even when zero provider
    // keys are configured, so it runs before any client is constructed.
    if (action === 'gatewayStatus') {
        return handleGatewayStatus(origin, req);
    }

    // The decision layer runs on the server-side OpenRouter key and never
    // touches the chat-model chain, so it dispatches before client construction.
    if (action === 'jevEvaluate') {
        return await handleJevEvaluate(payload, origin, req);
    }

    try {
        const clients = getCommunityClients();

        switch (action) {
            case 'testConnection':
                return await handleTestConnection(clients);

            case 'enhanceQuestIdea':
                return await handleEnhanceQuestIdea(clients, payload);

            case 'generateRandomQuestIdea':
                return await handleGenerateRandomQuestIdea(clients, payload);

            case 'generateQuestOutline':
                return await handleGenerateQuestOutline(clients, payload);

            case 'generatePregeneratedScenarios':
            case 'generateDynamicScenario':
                return await handleGenerateScenarios(clients, payload, action);

            case 'chat':
                return await handleChat(clients, payload);

            default:
                return new Response(`Unknown action: ${action}`, {
                    status: 400,
                    headers: corsHeaders(origin, req),
                });
        }
    } catch (error: any) {
        console.error(`Error in action handler for '${body?.action || 'unknown'}':`, error);
        return new Response('An unexpected error occurred. Please try again later.', {
            status: 500,
            headers: corsHeaders(origin, req),
        });
    }
}
