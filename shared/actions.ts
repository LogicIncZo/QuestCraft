// Shared API contract between client (services/aiService.ts) and
// serverless edge fn (api/generate.ts). Single source of truth for
// action names and payload shapes. Do not duplicate these in either side.
import { z } from 'zod';

export const API_ACTIONS = [
    'testConnection',
    'enhanceQuestIdea',
    'generateRandomQuestIdea',
    'generateQuestOutline',
    'generatePregeneratedScenarios',
    'generateDynamicScenario',
    'chat',
    'gatewayStatus',
    'jevEvaluate',
] as const;

export type ApiAction = (typeof API_ACTIONS)[number];

const localizedString = z.string().min(1);

export const ageGroupSchema = z.enum(['kids', 'pre-teens', 'teens', 'adults']);

export const actionPayloadSchemas = {
    testConnection: z.undefined(),
    // ageGroup is any UI string (e.g. 'any'); server normalizes via getAgeGroupText
    enhanceQuestIdea: z.object({
        idea: localizedString.max(8_000),
        ageGroup: z.string().min(1).max(32),
    }),
    generateRandomQuestIdea: z.object({
        ageGroup: z.string().min(1).max(32),
    }),
    generateQuestOutline: z.object({
        idea: localizedString,
        numLocations: z.number().int().min(2).max(40),
        positivity: z.number().min(0).max(100),
        groundingInReality: z.boolean(),
        supportedLanguages: z.array(z.string()).min(1),
        languageCode: z.string().min(2),
    }),
    generatePregeneratedScenarios: z.object({
        questConfig: z.any(),
        location: z.any(),
        numScenarios: z.number().int().min(1).max(10),
        languageCode: z.string().min(2),
    }),
    generateDynamicScenario: z.object({
        questConfig: z.any(),
        player: z.any(),
        location: z.any(),
        languageCode: z.string().min(2),
    }),
    chat: z.object({
        message: z.string().min(1).max(16_000),
        history: z
            .array(
                z.object({
                    role: z.enum(['user', 'model']),
                    content: z.string().max(8_000),
                })
            )
            .max(200),
        systemInstruction: z.string().max(64_000).optional(),
    }),
    // Ops surface: provider config + per-model health. No upstream calls.
    gatewayStatus: z.undefined(),
    // Jev (TypeSafe System One) structured-decision probe, routed through the
    // OpenRouter Decisions API. Server holds the key; payload is bounded so a
    // decision round-trip stays pennies on input and free on output tokens.
    jevEvaluate: z.object({
        state: z.string().min(1).max(8_000),
        questions: z
            .record(
                z.string().min(1).max(64),
                z.object({
                    type: z.enum(['choice', 'noul', 'score']),
                    instructions: z.string().min(1).max(1_000),
                    options: z
                        .array(z.string().min(1).max(128))
                        .min(2)
                        .max(8)
                        .optional(),
                })
            )
            .refine(
                (q) => Object.keys(q).length >= 1 && Object.keys(q).length <= 6,
                'questions must contain between 1 and 6 entries'
            ),
    }),
} as const satisfies Record<ApiAction, z.ZodTypeAny>;

export type ActionPayloadSchema = typeof actionPayloadSchemas;

export type ActionPayloads = {
    [A in ApiAction]: z.output<(typeof actionPayloadSchemas)[A]>;
};

export function apiRequestBody<A extends ApiAction>(
    action: A,
    payload: ActionPayloads[A]
): { action: A; payload: unknown } {
    return { action, payload };
}
