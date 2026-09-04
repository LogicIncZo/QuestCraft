import { describe, it, expect } from 'vitest';
import { buildFallbackScenario } from '../services/fallbackScenario';
import type { BoardLocation, Player, QuestConfig } from '../types';

const location: BoardLocation = {
    name: {
        en: 'Aadhaar Center',
        ta: 'ஆதார் மையம்',
    },
    description: { en: 'Enrollment center' },
    type: 'UTILITY' as BoardLocation['type'],
};

const player: Player = {
    id: 1,
    name: 'Player 1',
    isAI: false,
    position: 0,
    resources: { money: 1500 },
    isBankrupt: false,
    color: '#000',
} as unknown as Player;

const baseQuest = {
    name: { en: 'Aadhaar Quest' },
    description: { en: 'A quest' },
    resources: [
        { name: { en: 'Money' }, icon: 'MoneyIcon', barColor: 'bg-green-500', initialValue: 1500 },
        { name: { en: 'Time' }, icon: 'TimeIcon', barColor: 'bg-blue-500', initialValue: 200 },
    ],
    playerColors: ['#000'],
    board: { jailPosition: 0, locations: [] },
    chanceCards: [],
    footerSections: [],
} as unknown as QuestConfig;

describe('buildFallbackScenario (issue #78)', () => {
    it('produces a fully-formed, enabled scenario', () => {
        const scenario = buildFallbackScenario(baseQuest, player, location);

        expect(scenario.id).toBeTruthy();
        expect(scenario.custom).toBe(false);
        expect(scenario.enabled).toBe(true);
        expect(scenario.title.en).toContain('Aadhaar Center');
        expect(scenario.description.en).toContain('Player 1');
        expect(scenario.choices).toHaveLength(2);
    });

    it('is deterministic for identical inputs', () => {
        const a = buildFallbackScenario(baseQuest, player, location);
        const b = buildFallbackScenario(baseQuest, player, location);
        expect(a).toEqual(b);
    });

    it('varies by location so different tiles feel different', () => {
        const other: BoardLocation = { ...location, name: { ...location.name, en: 'Jail' } };
        const a = buildFallbackScenario(baseQuest, player, location);
        const b = buildFallbackScenario(baseQuest, player, other);
        expect(a.title.en).not.toBe(b.title.en);
    });

    it('references quest resource names in outcome resourceChanges', () => {
        const scenario = buildFallbackScenario(baseQuest, player, location);
        const changed = scenario.choices.flatMap((c) => c.outcome.resourceChanges.map((r) => r.name));
        expect(changed.length).toBeGreaterThan(0);
        for (const name of changed) {
            expect(['money', 'time']).toContain(name);
        }
    });

    it('covers supported languages with English fallback content present', () => {
        const scenario = buildFallbackScenario(baseQuest, player, location);
        for (const lang of ['en', 'es', 'hi', 'ta']) {
            expect(scenario.title[lang]).toBeTruthy();
            expect(scenario.description[lang]).toBeTruthy();
        }
        expect(scenario.choices[0].text.ta).toBeTruthy();
    });

    it('still works for single-resource quests', () => {
        const singleResourceQuest = {
            ...baseQuest,
            resources: [baseQuest.resources[0]],
        } as unknown as QuestConfig;
        const scenario = buildFallbackScenario(singleResourceQuest, player, location);
        for (const choice of scenario.choices) {
            expect(choice.outcome.resourceChanges.every((r) => r.name === 'money')).toBe(true);
        }
    });
});
