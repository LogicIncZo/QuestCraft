import { describe, it, expect, vi, beforeEach } from 'vitest';
import { questPreGenerator } from '../services/questPreGenerator';
import { BoardLocationType } from '../types';
import type { QuestConfig, BoardLocation } from '../types';

vi.mock('../services/aiService', () => ({
    generatePregeneratedScenarios: vi.fn(),
}));

vi.mock('../services/webSearchService', () => ({
    webSearchService: { search: vi.fn(async () => [{ title: 'r', snippet: 's' }]) },
}));

vi.mock('../services/statsService', () => ({
    statsService: { trackWebSearch: vi.fn() },
}));

import { generatePregeneratedScenarios } from '../services/aiService';
import { webSearchService } from '../services/webSearchService';
import { statsService } from '../services/statsService';

const mockGenerate = generatePregeneratedScenarios as unknown as ReturnType<typeof vi.fn>;
const mockSearch = webSearchService.search as unknown as ReturnType<typeof vi.fn>;

const loc = (name: string): BoardLocation => ({
    name: { en: name },
    description: { en: `${name} description` },
    type: BoardLocationType.PROPERTY,
});

const questConfig: QuestConfig = {
    description: { en: 'Budgeting quest' },
    board: {
        jailPosition: 0,
        locations: [
            loc('Market'),
            { name: { en: 'Start' }, description: { en: 'Go' }, type: 'START' },
            loc('School'),
        ],
    },
} as unknown as QuestConfig;

const scenarioFor = (locName: string) => [
    {
        id: `s_${locName}`,
        title: { en: `Scenario at ${locName}` },
        description: { en: 'd' },
        choices: [],
    },
];

describe('questPreGenerator.preGenerateQuest (issue #59)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSearch.mockResolvedValue([{ title: 'r', snippet: 's' }]);
    });

    it('generates scenarios for every PROPERTY location and reports metadata', async () => {
        mockGenerate.mockImplementation(async ({ location }) => scenarioFor(location.name.en));

        const progress: Array<[string, number]> = [];
        const result = await questPreGenerator.preGenerateQuest(questConfig, 'en', true, (m, p) =>
            progress.push([m, p])
        );

        expect(Object.keys(result.scenarios).sort()).toEqual(['Market', 'School']);
        expect(result.metadata.totalScenarios).toBe(2);
        expect(result.metadata.webSearchesPerformed).toBe(2);
        expect(result.metadata.webSearchFailures).toBe(0);
        expect(result.questConfig).toBe(questConfig);
        expect(mockSearch).toHaveBeenCalledTimes(2);
        expect(mockGenerate).toHaveBeenCalledTimes(2);
        expect(statsService.trackWebSearch).toHaveBeenCalled();
        expect(progress[progress.length - 1][1]).toBe(100);
    });

    it('falls back to ungrounded generation, then placeholder, when AI fails', async () => {
        mockGenerate.mockImplementation(async ({ location, useGrounding }: any) => {
            if (useGrounding) throw new Error('grounding provider down');
            if (location.name.en === 'Market') return scenarioFor('Market');
            throw new Error('total failure');
        });

        const result = await questPreGenerator.preGenerateQuest(questConfig, 'en', true);

        expect(result.scenarios['Market']).toEqual(scenarioFor('Market'));
        expect(result.scenarios['School']).toHaveLength(1);
        expect(result.scenarios['School'][0].id).toBe('fallback_School');
        expect(result.scenarios['School'][0].choices).toHaveLength(2);
        expect(result.metadata.totalScenarios).toBe(1); // only the AI-generated one counts; placeholder is a last resort
    });

    it('counts empty search results as failures and still completes', async () => {
        mockSearch.mockResolvedValue([]);
        mockGenerate.mockResolvedValue(scenarioFor('Market'));

        const result = await questPreGenerator.preGenerateQuest(questConfig, 'en', false);

        expect(result.metadata.webSearchesPerformed).toBe(2);
        expect(result.metadata.webSearchFailures).toBe(2);
        expect(result.metadata.totalScenarios).toBe(2);
    });

    it('handles quests with no PROPERTY locations', async () => {
        const noProps = {
            description: { en: 'x' },
            board: {
                jailPosition: 0,
                locations: [{ name: { en: 'Start' }, description: { en: 'Go' }, type: 'START' }],
            },
        } as unknown as QuestConfig;

        const result = await questPreGenerator.preGenerateQuest(noProps, 'en', true);

        expect(result.scenarios).toEqual({});
        expect(result.metadata.totalScenarios).toBe(0);
        expect(mockGenerate).not.toHaveBeenCalled();
    });
});
