import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROMPT_TEMPLATE_NAMES, fillPromptTemplate } from '../shared/prompts';
import {
    API_ACTIONS,
    apiRequestBody,
    actionPayloadSchemas,
} from '../shared/actions';

describe('shared/prompts fillPromptTemplate', () => {
    it('substitutes every occurrence of every placeholder', () => {
        const out = fillPromptTemplate('Hi {name}, meet {name} ({count}x)', {
            name: 'Ada',
            count: 3,
        });
        expect(out).toBe('Hi Ada, meet Ada (3x)');
    });

    it('leaves templates without placeholders unchanged', () => {
        expect(fillPromptTemplate('Static prompt.', {})).toBe('Static prompt.');
        expect(fillPromptTemplate('Static prompt.')).toBe('Static prompt.');
    });

    it('leaves unknown placeholders untouched', () => {
        expect(fillPromptTemplate('Hello {unknown}', {})).toBe('Hello {unknown}');
    });

    it('stringifies number replacements', () => {
        expect(fillPromptTemplate('{n} locations', { n: 12 })).toBe('12 locations');
    });

    it('treats regex-special replacement keys literally', () => {
        const out = fillPromptTemplate('X {a.b} Y', { 'a.b': 'dot' });
        expect(out).toBe('X dot Y');
    });

    it('all declared prompt templates exist on disk under public/prompts', () => {
        for (const name of PROMPT_TEMPLATE_NAMES) {
            expect(
                (() => {
                    try {
                        readFileSync(resolve(process.cwd(), 'public/prompts', name));
                        return true;
                    } catch {
                        return false;
                    }
                })(),
                `missing public/prompts/${name}`
            ).toBe(true);
        }
    });
});

describe('shared/actions contract', () => {
    it('apiRequestBody produces the { action, payload } envelope', () => {
        expect(apiRequestBody('testConnection', undefined)).toEqual({
            action: 'testConnection',
            payload: undefined,
        });
        expect(apiRequestBody('chat', { message: 'hi', history: [] })).toEqual({
            action: 'chat',
            payload: { message: 'hi', history: [] },
        });
    });

    it('every registered action has a payload schema and vice versa', () => {
        expect(Object.keys(actionPayloadSchemas).sort()).toEqual([...API_ACTIONS].sort());
    });

    it('chat: rejects empty messages, unknown roles, oversized content', () => {
        const chat = actionPayloadSchemas.chat;
        expect(chat.safeParse({ message: '', history: [] }).success).toBe(false);
        expect(chat.safeParse({ message: 'x'.repeat(16_001), history: [] }).success).toBe(false);
        expect(
            chat.safeParse({ message: 'hi', history: [{ role: 'assistant', content: 'x' }] })
                .success
        ).toBe(false);
        expect(
            chat.safeParse({ message: 'hi', history: [{ role: 'user', content: 'x'.repeat(8_001) }] })
                .success
        ).toBe(false);
        expect(chat.safeParse({ message: 'hi', history: Array(201).fill({ role: 'user', content: 'x' }) }).success).toBe(false);
        expect(chat.safeParse({ message: 'hi', history: [] }).success).toBe(true);
        // systemInstruction is optional but bounded
        expect(
            chat.safeParse({ message: 'hi', history: [], systemInstruction: 'x'.repeat(64_001) })
                .success
        ).toBe(false);
    });

    it('enhanceQuestIdea: bounds the idea and requires ageGroup', () => {
        const s = actionPayloadSchemas.enhanceQuestIdea;
        expect(s.safeParse({ idea: 'x'.repeat(8_001), ageGroup: 'kids' }).success).toBe(false);
        expect(s.safeParse({ idea: 'A game about markets', ageGroup: '' }).success).toBe(false);
        expect(s.safeParse({ idea: 'A game about markets', ageGroup: 'kids' }).success).toBe(true);
    });

    it('generateQuestOutline: enforces structural bounds', () => {
        const s = actionPayloadSchemas.generateQuestOutline;
        const valid = {
            idea: 'Markets',
            numLocations: 12,
            positivity: 50,
            groundingInReality: true,
            supportedLanguages: ['en'],
            languageCode: 'en',
        };
        expect(s.safeParse(valid).success).toBe(true);
        expect(s.safeParse({ ...valid, numLocations: 1 }).success).toBe(false);
        expect(s.safeParse({ ...valid, numLocations: 41 }).success).toBe(false);
        expect(s.safeParse({ ...valid, numLocations: 2.5 }).success).toBe(false);
        expect(s.safeParse({ ...valid, positivity: -1 }).success).toBe(false);
        expect(s.safeParse({ ...valid, positivity: 101 }).success).toBe(false);
        expect(s.safeParse({ ...valid, supportedLanguages: [] }).success).toBe(false);
        expect(s.safeParse({ ...valid, languageCode: 'e' }).success).toBe(false);
    });

    it('generatePregeneratedScenarios: bounds numScenarios 1..10', () => {
        const s = actionPayloadSchemas.generatePregeneratedScenarios;
        const base = { questConfig: {}, location: {}, languageCode: 'en' };
        expect(s.safeParse({ ...base, numScenarios: 0 }).success).toBe(false);
        expect(s.safeParse({ ...base, numScenarios: 11 }).success).toBe(false);
        expect(s.safeParse({ ...base, numScenarios: 5 }).success).toBe(true);
    });

    it('testConnection accepts an undefined payload but rejects anything else', () => {
        const s = actionPayloadSchemas.testConnection;
        expect(s.safeParse(undefined).success).toBe(true);
        expect(s.safeParse({}).success).toBe(false);
        expect(s.safeParse('x').success).toBe(false);
    });
});
