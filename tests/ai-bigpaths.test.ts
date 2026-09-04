import { vi } from "vitest";
import { describe, it, expect, beforeEach } from 'vitest';
import {
    generateQuestOutline,
    generateDynamicScenario,
    getAIChoice,
} from '../services/aiService';
import type { QuestConfig, Player, BoardLocation, ManagedScenario } from '../types';

function sseResponse(text: string): Response {
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(text));
            controller.close();
        },
    });
    return new Response(stream, { status: 200 });
}

const quest: QuestConfig = {
    name: { en: 'Budget Quest' },
    description: { en: 'Learn budgeting' },
    positivity: 0.5,
    groundingInReality: false,
    board: {
        jailPosition: 0,
        locations: [
            { name: { en: 'Market' }, description: { en: 'd' }, type: 'PROPERTY' as never },
            { name: { en: 'Start' }, description: { en: 'd' }, type: 'START' as never },
        ],
    },
    chanceCards: [],
    communityChestCards: [],
    pregeneratedScenarios: {},
} as unknown as QuestConfig;

const player: Player = {
    name: 'Testy',
    money: 1000,
    position: 0,
    knowledge: 5,
    wellbeing: 5,
    inJail: false,
} as unknown as Player;

const market: BoardLocation = {
    name: { en: 'Market' },
    description: { en: 'd' },
    type: 'PROPERTY' as never,
};

describe('aiService big paths via community gateway (issue #59 coverage)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('generateQuestOutline parses streamed JSON, injects fields and fixes jail position', async () => {
        const outline = {
            name: { en: 'Q' },
            description: { en: 'D' },
            board: {
                jailPosition: 0,
                locations: [
                    { name: { en: 'A' }, description: { en: 'd' }, type: 'PROPERTY' },
                    { name: { en: 'Jail' }, description: { en: 'd' }, type: 'JAIL' },
                    { name: { en: 'B' }, description: { en: 'd' }, type: 'PROPERTY' },
                ],
            },
        };
        const fetchMock = async () => sseResponse(JSON.stringify(outline));
        (globalThis as any).fetch = vi.fn(fetchMock);
        const result = await generateQuestOutline('idea', 3, 0.7, true, ['en', 'ta']);
        expect(result.positivity).toBe(0.7);
        expect(result.groundingInReality).toBe(true);
        expect(result.supportedLanguages).toEqual(['en', 'ta']);
        expect(result.board!.jailPosition).toBe(1); // index of the JAIL location
    });

    it('generateQuestOutline falls back to midpoint jail position when no JAIL exists', async () => {
        const outline = {
            name: { en: 'Q' },
            description: { en: 'D' },
            board: {
                jailPosition: 0,
                locations: [
                    { name: { en: 'A' }, description: { en: 'd' }, type: 'PROPERTY' },
                    { name: { en: 'B' }, description: { en: 'd' }, type: 'PROPERTY' },
                    { name: { en: 'C' }, description: { en: 'd' }, type: 'PROPERTY' },
                ],
            },
        };
        (globalThis as any).fetch = vi.fn(async () => sseResponse(JSON.stringify(outline)));
        const result = await generateQuestOutline('idea', 3, 0.5, false, ['en']);
        expect(result.board!.jailPosition).toBe(1); // floor(3/2)
    });

    it('generateDynamicScenario returns the streamed scenario object', async () => {
        const scenario = {
            id: 's1',
            title: { en: 'Market deal' },
            description: { en: 'A fair trade' },
            choices: [],
            custom: false,
            enabled: true,
        };
        (globalThis as any).fetch = vi.fn(async () => sseResponse(JSON.stringify(scenario)));
        const result = await generateDynamicScenario(quest, player, market);
        expect(result.title.en).toBe('Market deal');
    });

    it('getAIChoice falls back to a random choice for non-gemini providers', async () => {
        const choice = await getAIChoice(quest, market as unknown as ManagedScenario, player);
        expect([0, 1]).toContain(choice);
    });
});
