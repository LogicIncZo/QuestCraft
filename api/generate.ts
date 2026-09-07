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
// Community gateway chain: verified free models with per-request fallback.
// 1-3 OpenRouter free tier (NVIDIA nemotron family); 4-5 NVIDIA NIM direct
// (build.nvidia.com free tier, `NVIDIA_API_KEY`). Verified live 2026-09-07
// against response_format json_object + streaming. `lightning` was dropped:
// it leaks reasoning text into visible content.
type CommunityModelEntry = { model: string; client: 'openrouter' | 'nim' };
export const COMMUNITY_MODELS: CommunityModelEntry[] = [
    { model: 'nvidia/nemotron-3-ultra-550b-a55b:free', client: 'openrouter' },
    { model: 'nvidia/nemotron-3-super-120b-a12b:free', client: 'openrouter' },
    { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', client: 'openrouter' },
    { model: 'deepseek-ai/deepseek-v4-flash-0731', client: 'nim' },
    { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', client: 'nim' },
];
// Display-only default (first chain entry) — the server may serve any chain entry.
const COMMUNITY_MODEL = COMMUNITY_MODELS[0].model;

const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

interface CommunityClients {
    openrouter: OpenAI;
    nim?: OpenAI;
}

function getCommunityClients(): CommunityClients {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey) {
        throw new Error('Missing OPENROUTER_API_KEY environment variable.');
    }
    const openrouter = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: openrouterKey,
        defaultHeaders: {
            'HTTP-Referer': 'https://questcraft.ai',
            'X-Title': 'QuestCraft',
        },
    });
    const nimKey = process.env.NVIDIA_API_KEY;
    const nim = nimKey
        ? new OpenAI({
              baseURL: NIM_BASE_URL,
              apiKey: nimKey,
          })
        : undefined;
    return { openrouter, nim };
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

/**
 * Runs a community-tier completion against the first healthy model in
 * COMMUNITY_MODELS. Transient provider failures (model pulled, rate limit,
 * upstream overload) fall through to the next entry; NIM entries are
 * skipped when NVIDIA_API_KEY is not configured.
 */
async function communityCompletion(
    clients: CommunityClients,
    params: { messages: any[]; [key: string]: any }
): Promise<any> {
    let lastError: unknown;
    for (const entry of COMMUNITY_MODELS) {
        const client = entry.client === 'nim' ? clients.nim : clients.openrouter;
        if (!client) continue; // NIM key not configured -> skip NIM entries
        try {
            const stream = await client.chat.completions.create({
                ...(params as any),
                model: entry.model,
            });
            if (params.stream) {
                // Streaming errors surface on iteration, not at create() —
                // peek the first chunk here so upstream failures (429/502,
                // model pulled) trigger the fallback instead of blowing up
                // in the caller after we have returned a doomed stream.
                const iterator = (stream as any)[Symbol.asyncIterator]();
                const first = await iterator.next();
                if (first.done) {
                    throw new Error(`${entry.model} returned an empty stream`);
                }
                return guardedStream(first, iterator);
            }
            return stream;
        } catch (error) {
            lastError = error;
            console.warn(
                `[community-gateway] ${entry.model} failed: ${(error as Error).message}; trying next model`
            );
        }
    }
    throw lastError ?? new Error('No community gateway models are configured.');
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
    'https://aipoly.vercel.app',
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
    await communityCompletion(clients, {
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
    });
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
