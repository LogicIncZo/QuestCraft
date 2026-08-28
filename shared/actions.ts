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
