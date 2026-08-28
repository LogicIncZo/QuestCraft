import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => {
    const create = vi.fn(async function* () {
        yield { choices: [{ delta: { content: 'ok' } }] };
    });
    class MockOpenAI {
        chat = { completions: { create } };
    }
    return { default: MockOpenAI, __create: create };
});

import handler from '../../api/generate';
import * as openaiModule from 'openai';

const typedMockCreate = (openaiModule as unknown as { __create: ReturnType<typeof vi.fn> }).__create;

const ALLOWED_ORIGIN = 'https://aipoly.vercel.app';

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
        const res = await handler(postRequest({ action: 'chat', payload: { message: 'hi', history: [] } }));
        expect(res.status).toBe(200);
        expect(typedMockCreate).toHaveBeenCalled();
    });

    it('allows requests without an Origin header (non-browser clients)', async () => {
        const res = await handler(postRequest({ action: 'chat', payload: { message: 'hi', history: [] } }, null));
        expect(res.status).toBe(200);
    });

    it('blocks requests from a non-allowlisted origin with 403', async () => {
        const res = await handler(postRequest({ action: 'chat', payload: { message: 'hi', history: [] } }, 'https://evil.example'));
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
        const res = await handler(postRequest({ action: 'chat', payload: { message: 'hi', history } }));
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

    it('returns a generic error message on internal failure (no provider error leakage)', async () => {
        typedMockCreate.mockImplementationOnce(() => {
            throw new Error('OpenRouter quota exceeded for account billing@example.com');
        });

        const res = await handler(postRequest({ action: 'chat', payload: { message: 'hi', history: [] } }));
        const text = await res.text();
        expect(text).not.toContain('quota');
        expect(text).not.toContain('billing@example.com');
        expect(text).not.toContain('OpenRouter');
        expect(text).toContain('unexpected error');
    });
});
