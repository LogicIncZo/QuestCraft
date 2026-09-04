import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        finest: vi.fn(),
    },
}));

import { testConnection, enhanceQuestIdea, chatManager, loadPrompt } from '../services/aiService';
import { settingsService, defaultSettings } from '../services/settingsService';
import { statsService } from '../services/statsService';
import { TokenLimitExceededError } from '../services/aiService';

const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const c of chunks) controller.enqueue(encoder.encode(c));
            controller.close();
        },
    });
    return new Response(stream, { status: 200 });
}

function okJson(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchMock.mockReset();
    // default: community provider, nothing stored
    settingsService.saveSettings({ ...defaultSettings });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('aiService coverage (issue #59)', () => {
    describe('testConnection', () => {
        it('resolves for a healthy community gateway', async () => {
            fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
            await expect(testConnection({ ...defaultSettings.ai })).resolves.toBeUndefined();
            const [url, init] = fetchMock.mock.calls[0];
            expect(String(url)).toBe('/api/generate');
            expect(JSON.parse(init.body).action).toBe('testConnection');
        });

        it('throws with the gateway error text on failure', async () => {
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => 'backend on fire',
            } as unknown as Response);
            await expect(testConnection({ ...defaultSettings.ai })).rejects.toThrow(
                /Community Gateway connection failed: backend on fire/
            );
        });
    });

    describe('enhanceQuestIdea (community gateway path)', () => {
        it('returns the assembled stream text', async () => {
            fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
                if (String(url) === '/locales/en.json') {
                    return okJson({});
                }
                if (String(url) === '/api/generate') {
                    return sseResponse(['Enhanced: ', 'a quest about ', 'budgeting']);
                }
                throw new Error(`unhandled fetch ${url}`);
            });
            const out = await enhanceQuestIdea('a budgeting game', 'teens');
            expect(out).toBe('Enhanced: a quest about budgeting');
            const [, init] = fetchMock.mock.calls.find(
                ([u]) => String(u) === '/api/generate'
            ) as [string, RequestInit];
            const body = JSON.parse(String(init.body));
            expect(body.action).toBe('enhanceQuestIdea');
            expect(body.payload.idea).toBe('a budgeting game');
        });

        it('propagates gateway errors', async () => {
            fetchMock.mockImplementation(async (url: string) => {
                if (String(url) === '/locales/en.json') return okJson({});
                if (String(url) === '/api/generate') {
                    return new Response('nope', { status: 502 });
                }
                throw new Error(`unhandled fetch ${url}`);
            });
            await expect(enhanceQuestIdea('x', 'kids')).rejects.toThrow();
        });
    });

    describe('token-limit preflight (via public API)', () => {
        it('throws TokenLimitExceededError when quota is exhausted with a keyed provider', async () => {
            settingsService.saveSettings({
                ...defaultSettings,
                ai: { providerId: 'openai', model: 'gpt-4o' },
            });
            // exhaust quota
            statsService.updateTokens({ inputTokens: 2_000_000, outputTokens: 0 });
            await expect(enhanceQuestIdea('x', 'kids')).rejects.toBeInstanceOf(
                TokenLimitExceededError
            );
        });

        it('does not enforce the limit when a session key overrides the shared pool', async () => {
            settingsService.saveSettings({
                ...defaultSettings,
                ai: { providerId: 'openai', model: 'gpt-4o' },
            });
            statsService.updateTokens({ inputTokens: 2_000_000, outputTokens: 0 });
            settingsService.saveSessionApiKey('sk-override');
            // will fail later at the network layer, but NOT with TokenLimitExceededError
            fetchMock.mockRejectedValue(new Error('network down'));
            await expect(enhanceQuestIdea('x', 'kids')).rejects.not.toBeInstanceOf(
                TokenLimitExceededError
            );
            settingsService.clearSessionApiKey();
        });
    });

    describe('chatManager', () => {
        it('supports community provider statelessly (no instance init)', () => {
            expect(() => chatManager.initialize('sys')).not.toThrow();
        });

        it('yields a friendly message for unsupported providers', async () => {
            settingsService.saveSettings({
                ...defaultSettings,
                ai: { providerId: 'openai', model: 'gpt-4o' },
            });
            const gen = chatManager.sendMessageStream('hi', []);
            const first = await gen.next();
            expect(first.value).toMatch(/only available with/);
            expect(first.done).toBe(false);
        });

        it('streams the community gateway reply', async () => {
            fetchMock.mockImplementation(async (url: string) => {
                if (String(url) === '/locales/en.json') return okJson({});
                if (String(url) === '/api/generate') {
                    return sseResponse(['Hello! ', 'How can I help?']);
                }
                throw new Error(`unhandled fetch ${url}`);
            });
            chatManager.initialize('sys-instr');
            const gen = chatManager.sendMessageStream('hi', [
                { role: 'user', content: 'earlier' },
            ]);
            let full = '';
            for await (const chunk of gen) full += chunk;
            expect(full).toBe('Hello! How can I help?');
            const [, init] = fetchMock.mock.calls.find(
                ([u]) => String(u) === '/api/generate'
            ) as [string, RequestInit];
            const body = JSON.parse(String(init.body));
            expect(body.payload.systemInstruction).toBe('sys-instr');
            expect(body.payload.history).toEqual([{ role: 'user', content: 'earlier' }]);
        });

        it('surfaces a generic mid-stream error and still completes', async () => {
            fetchMock.mockImplementation(async (url: string) => {
                if (String(url) === '/locales/en.json') return okJson({});
                if (String(url) === '/api/generate') {
                    return new Response('down', { status: 503 });
                }
                throw new Error(`unhandled fetch ${url}`);
            });
            chatManager.initialize('sys');
            const gen = chatManager.sendMessageStream('hi', []);
            let full = '';
            let ended = false;
            for await (const chunk of gen) full += chunk;
            ended = true;
            expect(full).toMatch(/error/i);
            expect(ended).toBe(true);
        });
    });

    describe('loadPrompt', () => {
        it('caches the fetched template and substitutes replacements', async () => {
            fetchMock.mockImplementation(async (url: string) => {
                if (String(url) === '/locales/en.json') return okJson({});
                if (String(url).startsWith('/prompts/test-template.txt')) {
                    return { ok: true, text: async () => 'Hello {name}!' } as unknown as Response;
                }
                throw new Error(`unhandled fetch ${url}`);
            });
            const first = await loadPrompt('/prompts/test-template.txt', { name: 'World' });
            const second = await loadPrompt('/prompts/test-template.txt', { name: 'Again' });
            expect(first).toBe('Hello World!');
            expect(second).toBe('Hello Again!');
            // second call must be served from cache, not the network
            const promptFetches = fetchMock.mock.calls.filter(([u]) =>
                String(u).startsWith('/prompts/')
            );
            expect(promptFetches).toHaveLength(1);
        });
    });
});
