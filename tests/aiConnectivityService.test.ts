import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    aiConnectivityService,
    CONNECTIVITY_UPDATED_EVENT,
} from '../services/aiConnectivityService';

const STATUS_KEY = 'questcraft-ai-connectivity-status';

describe('aiConnectivityService', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('defaults to disconnected when nothing was ever stored', () => {
        expect(aiConnectivityService.isConnected()).toBe(false);
    });

    it('round-trips a connected status and dispatches an update event', () => {
        const events: string[] = [];
        const listener = () => events.push(CONNECTIVITY_UPDATED_EVENT);
        window.addEventListener(CONNECTIVITY_UPDATED_EVENT, listener);
        try {
            aiConnectivityService.setConnected(true);
            expect(aiConnectivityService.isConnected()).toBe(true);
            expect(events).toEqual([CONNECTIVITY_UPDATED_EVENT]);
        } finally {
            window.removeEventListener(CONNECTIVITY_UPDATED_EVENT, listener);
        }
    });

    it('stores valid JSON in localStorage under the stable key', () => {
        aiConnectivityService.setConnected(true);
        expect(localStorage.getItem(STATUS_KEY)).toBe('true');
        aiConnectivityService.setConnected(false);
        expect(localStorage.getItem(STATUS_KEY)).toBe('false');
    });

    it('treats corrupt stored JSON as disconnected instead of throwing', () => {
        localStorage.setItem(STATUS_KEY, '{not valid json');
        expect(aiConnectivityService.isConnected()).toBe(false);
    });

    it('treats a failed write as non-fatal and keeps the service usable', () => {
        const setItemSpy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });
        expect(() => aiConnectivityService.setConnected(true)).not.toThrow();
        expect(aiConnectivityService.isConnected()).toBe(false);
        setItemSpy.mockRestore();

        const getItemSpy = vi
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('SecurityError');
            });
        expect(aiConnectivityService.isConnected()).toBe(false);
        getItemSpy.mockRestore();
    });

    it('does not dispatch an update event when the write fails', () => {
        const events: string[] = [];
        const listener = () => events.push('update');
        window.addEventListener(CONNECTIVITY_UPDATED_EVENT, listener);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        try {
            aiConnectivityService.setConnected(true);
            expect(events).toEqual([]);
        } finally {
            window.removeEventListener(CONNECTIVITY_UPDATED_EVENT, listener);
            vi.restoreAllMocks();
        }
    });
});
