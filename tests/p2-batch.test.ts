import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeSetItem, setVersionedItem, getVersionedItem } from '../services/storageService';
import { gameStateService } from '../services/gameStateService';
import { settingsService, SETTINGS_VERSION } from '../services/settingsService';

describe('storageService.safeSetItem quota path (issue #55)', () => {
    it('returns false instead of throwing on QuotaExceededError', () => {
        const failing = {
            getItem: () => null,
            setItem: () => {
                const e = new Error('quota');
                e.name = 'QuotaExceededError';
                throw e;
            },
            removeItem: () => {},
        } as unknown as Storage;
        expect(safeSetItem(failing, 'k', 'v')).toBe(false);
    });

    it('returns true on success and false on any storage failure', () => {
        let backing = '';
        const ok = {
            getItem: () => backing,
            setItem: (_k: string, v: string) => {
                backing = v;
            },
            removeItem: () => {
                backing = '';
            },
        } as unknown as Storage;
        expect(safeSetItem(ok, 'k', 'v')).toBe(true);
        const broken = {
            getItem: () => null,
            setItem: () => {
                throw new Error('SecurityError');
            },
            removeItem: () => {},
        } as unknown as Storage;
        expect(safeSetItem(broken, 'k', 'v')).toBe(false);
    });

    it('setVersionedItem tags schemaVersion and getVersionedItem rejects mismatches', () => {
        const store = new Map<string, string>();
        const s = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => {
                store.set(k, v);
            },
            removeItem: (k: string) => {
                store.delete(k);
            },
        } as unknown as Storage;
        expect(setVersionedItem(s, 'q', { hp: 10 })).toBe(true);
        const raw = JSON.parse(store.get('q')!);
        expect(raw.schemaVersion).toBe(1);
        expect(getVersionedItem(s, 'q')).toEqual({ hp: 10 });

        // stale version => dropped, key removed
        store.set('q', JSON.stringify({ schemaVersion: 0, hp: 99 }));
        expect(getVersionedItem(s, 'q')).toBeNull();
        expect(store.has('q')).toBe(false);

        // corrupted JSON => dropped
        store.set('q', '{not json');
        expect(getVersionedItem(s, 'q')).toBeNull();
    });

    it('gameStateService.save survives quota errors without throwing', () => {
        const failing = {
            getItem: () => null,
            setItem: () => {
                const e = new Error('quota');
                e.name = 'QuotaExceededError';
                throw e;
            },
            removeItem: () => {},
        } as unknown as Storage;
        const orig = globalThis.localStorage;
        Object.defineProperty(globalThis, 'localStorage', { value: failing, configurable: true });
        expect(() => gameStateService.save({ currentStageIndex: 3 } as any)).not.toThrow();
        Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true });
    });
});

describe('settingsService versioning (issue #55)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves settingsVersion and reads it back', () => {
        settingsService.saveSettings({
            ai: { providerId: 'community', model: 'm', baseUrl: 'b', aiRequestDelayMs: 0 },
            language: 'en',
        } as any);
        const raw = JSON.parse(localStorage.getItem('questcraft-app-settings')!);
        expect(raw.settingsVersion).toBe(SETTINGS_VERSION);
    });

    it('migrates legacy settings without settingsVersion', () => {
        localStorage.setItem(
            'questcraft-app-settings',
            JSON.stringify({
                ai: { providerId: 'openrouter', apiKey: 'sk-legacy', model: 'x', baseUrl: 'y' },
                language: 'en',
            })
        );
        const merged = settingsService.getSettings();
        expect(merged.ai.providerId).toBe('openrouter');
        expect((merged.ai as any).apiKey).toBeUndefined();
    });
});
