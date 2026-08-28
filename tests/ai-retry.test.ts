import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), finest: vi.fn() },
}));

import { withRetry, TokenLimitExceededError } from '../services/aiService';

const makeErr = (status?: number, msg = 'api error') => {
    const e: any = new Error(msg);
    if (status) e.status = status;
    return e;
};

describe('withRetry fail-fast policy (issue #55)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('fails fast on 401 without any retry sleeps', async () => {
        const spySetTimeout = vi.spyOn(globalThis, 'setTimeout');
        const call = vi.fn().mockRejectedValue(makeErr(401));
        await expect(withRetry(call, 3, 1000)).rejects.toThrow('api error');
        expect(call).toHaveBeenCalledTimes(1);
        expect(spySetTimeout).not.toHaveBeenCalled();
        spySetTimeout.mockRestore();
    });

    it('retries 429s up to maxRetries', async () => {
        vi.useRealTimers();
        const call = vi
            .fn()
            .mockRejectedValueOnce(makeErr(429))
            .mockRejectedValueOnce(makeErr(429))
            .mockResolvedValue('ok');
        const result = await withRetry(call, 3, 1);
        expect(result).toBe('ok');
        expect(call).toHaveBeenCalledTimes(3);
    });

    it('retries 5xx and network errors, then throws after maxRetries', async () => {
        vi.useRealTimers();
        const call = vi.fn().mockRejectedValue(makeErr(503));
        await expect(withRetry(call, 2, 1)).rejects.toThrow();
        expect(call).toHaveBeenCalledTimes(3);
    });

    it('never retries TokenLimitExceededError', async () => {
        vi.useRealTimers();
        const call = vi.fn().mockRejectedValue(new TokenLimitExceededError('limit'));
        await expect(withRetry(call, 3, 1)).rejects.toBeInstanceOf(TokenLimitExceededError);
        expect(call).toHaveBeenCalledTimes(1);
    });
});
