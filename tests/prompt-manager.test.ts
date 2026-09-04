import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), finest: vi.fn() },
}));

import { promptManager } from '../services/promptManager';
import {
    detectCapabilities,
    selectPromptVariant,
    MODEL_CAPABILITIES,
    type ModelCapabilities,
} from '../services/modelCapabilityDetector';
import { webSearchService } from '../services/webSearchService';
import { SearchEngine } from '../types';

const caps = (over: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
    supportsJsonSchema: true,
    supportsTools: false,
    supportsThinking: false,
    maxContextTokens: 128_000,
    prefersMarkdown: false,
    requiresJsonOnly: true,
    canDoWebSearch: false,
    supportsStreaming: true,
    qualityTier: 'high',
    supportsMultiLanguage: true,
    ...over,
});

describe('modelCapabilityDetector (issue #59 coverage)', () => {
    it('returns registry entries and a default for unknown models', () => {
        expect(detectCapabilities('openai/gpt-4o')).toBe(MODEL_CAPABILITIES['openai/gpt-4o']);
        const fallback = detectCapabilities('totally/unknown-model');
        expect(fallback).toBe(MODEL_CAPABILITIES.default);
        expect(fallback.qualityTier).toBe('basic');
    });

    it('community model cannot do web search', () => {
        expect(detectCapabilities('openai/gpt-oss-20b:free').canDoWebSearch).toBe(false);
    });

    it('selectPromptVariant strips schema for non-JSON-schema models', () => {
        const p = 'Intro\n# JSON Schema\n{"a":1}\n# Your Task\nDo it.';
        const out = selectPromptVariant(p, caps({ supportsJsonSchema: false }), false);
        expect(out).not.toContain('# JSON Schema');
    });

    it('selectPromptVariant appends tool instructions only for capable models', () => {
        const base = '# Your Task\nDo it.';
        const withTools = selectPromptVariant(base, caps({ supportsTools: true }), false);
        expect(withTools).toContain('# Available Tools');
        const without = selectPromptVariant(base, caps({ supportsTools: false }), false);
        expect(without).not.toContain('# Available Tools');
    });

    it('selectPromptVariant adds thinking instructions for markdown thinkers', () => {
        const out = selectPromptVariant(
            '# Your Task\nDo it.',
            caps({ supportsThinking: true, prefersMarkdown: true }),
            false
        );
        expect(out).toContain('<thinking>');
    });
});

describe('promptManager (issue #59 coverage)', () => {
    it('extractJson passes text through when JSON is not required', () => {
        const r = promptManager.extractJson('plain text', caps({ requiresJsonOnly: false }));
        expect(r.isValid).toBe(true);
        expect(r.data).toBe('plain text');
    });

    it('extractJson parses direct JSON when required', () => {
        const r = promptManager.extractJson('{"a":1}', caps());
        expect(r.isValid).toBe(true);
        expect(r.data).toEqual({ a: 1 });
    });

    it('extractJson recovers from a markdown code block', () => {
        const r = promptManager.extractJson('preamble\n```json\n{"a":2}\n```', caps());
        expect(r.isValid).toBe(true);
        expect(r.method).toBe('markdown-extraction');
        expect(r.data).toEqual({ a: 2 });
    });

    it('extractJson falls back to bracket extraction inside a broken code block', () => {
        const r = promptManager.extractJson('```json\noops {"a":3}\n```', caps());
        expect(r.isValid).toBe(true);
        expect(r.method).toBe('bracket-extraction');
        expect(r.data).toEqual({ a: 3 });
    });

    it('extractJson reports no valid JSON when brackets are absent', () => {
        const r = promptManager.extractJson('junk {"a":3} tail', caps());
        expect(r.isValid).toBe(false);
        expect(r.error).toBe('No valid JSON found in output');
    });

    it('extractJson reports failure when nothing parses', () => {
        const r = promptManager.extractJson('no json at all', caps());
        expect(r.isValid).toBe(false);
        expect(r.error).toContain('No valid JSON');
    });

    it('generateFallbackPrompt maps known error types and passes through unknown', () => {
        expect(promptManager.generateFallbackPrompt('P', 'json-fail')).toContain('P');
        expect(promptManager.generateFallbackPrompt('P', 'context-overflow')).toContain(
            'scenario with title'
        );
        expect(promptManager.generateFallbackPrompt('P', 'mystery')).toBe('P');
    });

    it('loadAndAdapt applies variant selection and language warnings', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (String(url).includes('tpl.txt')) {
                return { ok: true, text: async () => 'Template for {languageCode}' } as Response;
            }
            throw new Error(`unhandled fetch: ${url}`);
        });
        (globalThis as any).fetch = fetchMock;

        const out = await promptManager.loadAndAdapt({
            templateName: 'tpl.txt',
            replacements: { languageCode: 'en', languageList: ['en', 'es', 'hi'] },
            capabilities: caps({ supportsMultiLanguage: false, requiresJsonOnly: false }),
            requireJsonOutput: false,
        });
        expect(out).toContain('LANGUAGE LIMITATION WARNING');
        expect(out).toContain('Template for en');
    });
});

describe('webSearchService (issue #59 coverage)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns [] in community mode (search not available)', async () => {
        (globalThis as any).settingsService = { getAiSettings: () => ({ providerId: 'community' }) };
        const results = await webSearchService.search('q');
        expect(results).toEqual([]);
    });

    it('returns [] when no Exa key is configured in BYOLLM mode', async () => {
        (globalThis as any).settingsService = { getAiSettings: () => ({ providerId: 'openai' }) };
        const saved = webSearchService.EXA_API_KEY;
        (webSearchService as any).EXA_API_KEY = undefined;
        const results = await webSearchService.search('q');
        expect(results).toEqual([]);
        (webSearchService as any).EXA_API_KEY = saved;
    });

    it('searchExa maps API results and tolerates failure with []', async () => {
        (globalThis as any).settingsService = { getAiSettings: () => ({ providerId: 'openai' }) };
        const saved = webSearchService.EXA_API_KEY;
        (webSearchService as any).EXA_API_KEY = 'test-key';

        (globalThis as any).fetch = vi.fn(async () =>
            ({
                ok: true,
                json: async () => ({
                    results: [
                        {
                            title: 'T',
                            url: 'https://x',
                            text: 's',
                            publishedDate: '2026-01-01',
                            source: 'exa',
                        },
                    ],
                }),
            } as Response)
        );
        const ok = await webSearchService.search('q', { engine: SearchEngine.EXA, maxResults: 5 });
        expect(ok).toHaveLength(1);
        expect(ok[0]).toMatchObject({ title: 'T', url: 'https://x', source: 'exa' });

        (globalThis as any).fetch = vi.fn(async () => {
            throw new Error('network down');
        });
        const failed = await webSearchService.search('q', {
            engine: SearchEngine.EXA,
            maxResults: 5,
        });
        expect(failed).toEqual([]);

        (webSearchService as any).EXA_API_KEY = saved;
    });

    it('duckduckgo parses result blocks from html', async () => {
        (globalThis as any).settingsService = { getAiSettings: () => ({ providerId: 'openai' }) };
        (globalThis as any).fetch = vi.fn(async () =>
            ({
                ok: true,
                status: 200,
                text: async () =>
                    '<a class="result__a" href="https://a.example">T1</a><a class="result__snippet">S1</a><a href="https://u1.example">u1</a><a class="result__a" href="https://b.example">T2</a><a class="result__snippet">S2</a><a href="https://u2.example">u2</a>',
            } as Response)
        );
        const results = await webSearchService.searchDuckDuckGo('q', {
            engine: SearchEngine.DUCKDUCKGO,
            maxResults: 5,
        });
        expect(results.length).toBe(2);
        expect(results[1]).toEqual({ title: 'T2', snippet: 'S2', url: 'https://b.example', source: 'DuckDuckGo' });
    });
});
