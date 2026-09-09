import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('openai', () => {
    const create = vi.fn(async function* () {
        yield { choices: [{ delta: { content: 'ok' } }] };
    });
    class MockOpenAI {
        chat = { completions: { create } };
    }
    return { default: MockOpenAI, __create: create };
});

import handler, {
    COMMUNITY_MODELS,
} from '../../api/generate';
import * as openaiModule from 'openai';

const typedMockCreate = (openaiModule as unknown as { __create: ReturnType<typeof vi.fn> })
    .__create;

const ALLOWED_ORIGIN = 'https://aipoly.vercel.app';

// Env stubs must not leak between tests — NVIDIA_API_KEY set in one suite
// would otherwise make the 'NIM skipped' test see a configured key.
afterEach(() => {
    vi.unstubAllEnvs();
});

function postRequest(body: string | object, origin: string | null = ALLOWED_ORIGIN) {
    return new Request('https://aipoly.vercel.app/api/generate', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(origin ? { origin } : {}),
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

describe('api/generate security hardening (issue #56)', () => {
    beforeEach(() => {
        vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
        typedMockCreate.mockClear();
    });

    it('allows requests from an allowlisted origin', async () => {
        const res = await handler(
            postRequest({
                action: 'chat',
                payload: {
                    message: 'hi',
                    history: [],
                    systemInstruction: 'You are a helpful game master.',
                },
            })
        );
        expect(res.status).toBe(200);
        expect(typedMockCreate).toHaveBeenCalled();
    });

    it('allows requests without an Origin header (non-browser clients)', async () => {
        const res = await handler(
            postRequest(
                {
                    action: 'chat',
                    payload: {
                        message: 'hi',
                        history: [],
                        systemInstruction: 'You are a helpful game master.',
                    },
                },
                null
            )
        );
        expect(res.status).toBe(200);
    });

    it('blocks requests from a non-allowlisted origin with 403', async () => {
        const res = await handler(
            postRequest(
                {
                    action: 'chat',
                    payload: {
                        message: 'hi',
                        history: [],
                        systemInstruction: 'You are a helpful game master.',
                    },
                },
                'https://evil.example'
            )
        );
        expect(res.status).toBe(403);
        expect(typedMockCreate).not.toHaveBeenCalled();
    });

    it('answers OPTIONS preflight with 204 and CORS headers for allowed origins', async () => {
        const req = new Request('https://aipoly.vercel.app/api/generate', {
            method: 'OPTIONS',
            headers: { origin: ALLOWED_ORIGIN },
        });
        const res = await handler(req);
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    });

    it('returns 400 (not 500) on malformed JSON body', async () => {
        const res = await handler(postRequest('{not json'));
        expect(res.status).toBe(400);
    });

    it('caps oversized chat history server-side', async () => {
        const history = Array.from({ length: 100 }, (_, i) => ({
            role: 'user',
            content: `msg-${i}-${'x'.repeat(2000)}`,
        }));
        const res = await handler(
            postRequest({
                action: 'chat',
                payload: {
                    message: 'hi',
                    history,
                    systemInstruction: 'You are a helpful game master.',
                },
            })
        );
        expect(res.status).toBe(200);

        expect(typedMockCreate).toHaveBeenCalled();
        const messages = typedMockCreate.mock.calls[0][0].messages;
        expect(messages.length).toBeLessThanOrEqual(42); // system + 40 history + user message
        const totalHistoryChars = messages
            .slice(1, -1)
            .reduce((n: number, m: any) => n + m.content.length, 0);
        expect(totalHistoryChars).toBeLessThanOrEqual(32_000 + 40 * 8_000);
        // keeps the most recent messages, not the oldest
        expect(messages[messages.length - 2].content).toContain('msg-99-');
    });

    it('falls back to the next community model when the primary fails', async () => {
        typedMockCreate.mockImplementationOnce(() => {
            throw new Error('OpenRouter quota exceeded for account billing@example.com');
        });

        const res = await handler(
            postRequest({
                action: 'chat',
                payload: {
                    message: 'hi',
                    history: [],
                    systemInstruction: 'You are a helpful game master.',
                },
            })
        );
        expect(res.status).toBe(200);
        expect(typedMockCreate.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(typedMockCreate.mock.calls[0][0].model).toBe(
            'nvidia/nemotron-3-ultra-550b-a55b:free'
        );
        expect(typedMockCreate.mock.calls[1][0].model).toBe(
            'nvidia/nemotron-3-super-120b-a12b:free'
        );
        const text = await res.text();
        expect(text).not.toContain('quota');
        expect(text).not.toContain('billing@example.com');
        expect(text).not.toContain('OpenRouter');
    });

    it('returns a generic error message when the whole chain fails (no provider error leakage)', async () => {
        typedMockCreate.mockImplementation(() => {
            throw new Error('OpenRouter quota exceeded for account billing@example.com');
        });

        const res = await handler(
            postRequest({
                action: 'chat',
                payload: {
                    message: 'hi',
                    history: [],
                    systemInstruction: 'You are a helpful game master.',
                },
            })
        );
        const text = await res.text();
        expect(text).not.toContain('quota');
        expect(text).not.toContain('billing@example.com');
        expect(text).not.toContain('OpenRouter');
        expect(text).toContain('unexpected error');
        typedMockCreate.mockImplementation(async function* () {
            yield { choices: [{ delta: { content: 'ok' } }] };
        } as any);
    });

    it('falls back to the next model when the primary stream errors before the first chunk', async () => {
        vi.stubEnv('NVIDIA_API_KEY', 'nim-key');
        // First call (ultra via OpenRouter): create() resolves lazily and the
        // upstream 502 only surfaces when the stream is first iterated. The
        // guard peeks chunk #1 inside the try, so this triggers fallback.
        // Note: failures AFTER a chunk has been delivered to the client are
        // not recoverable (streaming already began) — by design.
        typedMockCreate.mockImplementationOnce(() => {
            const bad = async function* () {
                throw new Error('Upstream error from Nvidia: Service temporarily overloaded');
                yield 0; // unreachable; satisfies require-yield
            };
            return bad();
        });

        const res = await handler(
            postRequest({
                action: 'chat',
                payload: { message: 'hi', history: [], systemInstruction: 'sys' },
            })
        );
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain('Overloaded');
        // Second call must have gone to the next chain entry (super), not the failed model
        expect(typedMockCreate).toHaveBeenCalledTimes(2);
        const secondCallModel = typedMockCreate.mock.calls[1][0].model;
        expect(secondCallModel).not.toBe(COMMUNITY_MODELS[0].model);
    });
});

describe('api/generate gateway robustness (hardening pass 2026-09-09)', () => {
    const chatPayload = {
        message: 'hi',
        history: [],
        systemInstruction: 'sys',
    };

    beforeEach(() => {
        vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
        typedMockCreate.mockReset();
        typedMockCreate.mockImplementation(async function* () {
            yield { choices: [{ delta: { content: 'ok' } }] };
        } as any);
    });

    it('rejects an unknown action with 400 and never touches the AI chain', async () => {
        const res = await handler(
            postRequest({ action: 'deleteAllUsers', payload: {} })
        );
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Unknown action');
        expect(typedMockCreate).not.toHaveBeenCalled();
    });

    it('rejects a chat payload with an empty message via the zod contract', async () => {
        const res = await handler(
            postRequest({ action: 'chat', payload: { ...chatPayload, message: '' } })
        );
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Invalid payload');
        expect(typedMockCreate).not.toHaveBeenCalled();
    });

    it('rejects an oversized enhanceQuestIdea payload (>8k chars) with 400', async () => {
        const res = await handler(
            postRequest({
                action: 'enhanceQuestIdea',
                payload: { idea: 'x'.repeat(8_001), ageGroup: 'teens' },
            })
        );
        expect(res.status).toBe(400);
        expect(typedMockCreate).not.toHaveBeenCalled();
    });

    it('enforces the generateQuestOutline numeric bounds', async () => {
        for (const numLocations of [1, 41]) {
            const res = await handler(
                postRequest({
                    action: 'generateQuestOutline',
                    payload: {
                        idea: 'A day at the market',
                        numLocations,
                        positivity: 50,
                        groundingInReality: false,
                        supportedLanguages: ['en'],
                        languageCode: 'en',
                    },
                })
            );
            expect(res.status).toBe(400);
        }
        expect(typedMockCreate).not.toHaveBeenCalled();
    });

    it('returns 405 for non-POST/non-OPTIONS methods', async () => {
        const res = await handler(
            new Request('https://aipoly.vercel.app/api/generate', {
                method: 'GET',
                headers: { origin: ALLOWED_ORIGIN },
            })
        );
        expect(res.status).toBe(405);
    });

    it('blocks OPTIONS preflight from disallowed origins with 403', async () => {
        const res = await handler(
            new Request('https://aipoly.vercel.app/api/generate', {
                method: 'OPTIONS',
                headers: { origin: 'https://evil.example' },
            })
        );
        expect(res.status).toBe(403);
    });

    it('fails closed with a generic 500 when OPENROUTER_API_KEY is missing', async () => {
        vi.stubEnv('OPENROUTER_API_KEY', '');
        const res = await handler(postRequest({ action: 'chat', payload: chatPayload }));
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(text).toContain('unexpected error');
        expect(text).not.toContain('OPENROUTER_API_KEY');
    });

    it('falls all the way through the OpenRouter chain to the NIM entry', async () => {
        vi.stubEnv('NVIDIA_API_KEY', 'nim-key');
        // First three calls (all OpenRouter entries) fail; the fourth call is
        // the first NIM entry (deepseek-ai/deepseek-v4-flash-0731) and succeeds.
        typedMockCreate
            .mockImplementationOnce(() => {
                throw new Error('OpenRouter: model pulled');
            })
            .mockImplementationOnce(() => {
                throw new Error('OpenRouter: rate limited (429)');
            })
            .mockImplementationOnce(() => {
                throw new Error('OpenRouter: upstream overloaded');
            });

        const res = await handler(postRequest({ action: 'chat', payload: chatPayload }));
        expect(res.status).toBe(200);
        expect(typedMockCreate).toHaveBeenCalledTimes(4);
        const fourthCall = typedMockCreate.mock.calls[3][0];
        expect(fourthCall.model).toBe('deepseek-ai/deepseek-v4-flash-0731');
        const text = await res.text();
        expect(text).toContain('ok');
        expect(text).not.toContain('429');
        expect(text).not.toContain('OpenRouter');
    });

    it('skips NIM entries entirely when NVIDIA_API_KEY is not configured', async () => {
        vi.stubEnv('NVIDIA_API_KEY', '');
        typedMockCreate.mockImplementation(() => {
            throw new Error('OpenRouter: everything is down');
        });

        const res = await handler(postRequest({ action: 'chat', payload: chatPayload }));
        expect(res.status).toBe(500);
        // Only the 3 OpenRouter entries were attempted; no NIM models called.
        expect(typedMockCreate).toHaveBeenCalledTimes(3);
        const calledModels = typedMockCreate.mock.calls.map(
            (c: any[]) => c[0].model
        );
        expect(calledModels).not.toContain('deepseek-ai/deepseek-v4-flash-0731');
        expect(calledModels).toEqual(COMMUNITY_MODELS.filter((m) => m.client === 'openrouter').map((m) => m.model));
    });

    it('treats an empty stream as a failure and moves to the next entry', async () => {
        typedMockCreate.mockImplementationOnce(async function* () {
            // yields nothing — empty stream
        } as any);

        const res = await handler(postRequest({ action: 'chat', payload: chatPayload }));
        expect(res.status).toBe(200);
        expect(typedMockCreate).toHaveBeenCalledTimes(2);
        const secondCall = typedMockCreate.mock.calls[1][0];
        expect(secondCall.model).toBe(COMMUNITY_MODELS[1].model);
    });

    it('answers testConnection with 200 on a healthy chain', async () => {
        const res = await handler(postRequest({ action: 'testConnection', payload: undefined }));
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('Connection successful');
        const firstCall = typedMockCreate.mock.calls[0][0];
        expect(firstCall.model).toBe(COMMUNITY_MODELS[0].model);
        expect(firstCall.max_tokens).toBe(1);
    });
});
