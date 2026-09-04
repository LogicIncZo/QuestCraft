import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { statsService, STATS_UPDATED_EVENT } from '../services/statsService';
import { auditLogService, AUDIT_LOG_UPDATED_EVENT } from '../services/auditLogService';
import { gameStateService } from '../services/gameStateService';
import { getLocalizedString } from '../utils/localization';
import {
    settingsService,
    defaultSettings,
    SETTINGS_VERSION,
    getProviderApiKeyFromEnv,
} from '../services/settingsService';

describe('statsService (issue #59 coverage)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('returns zeroed defaults when nothing is stored', () => {
        const stats = statsService.getStats();
        expect(stats.totalInputTokens).toBe(0);
        expect(stats.totalOutputTokens).toBe(0);
        expect(stats.totalCost).toBe(0);
        expect(stats.timePlayedInSeconds).toBe(0);
        expect(stats.webSearchRequests).toBe(0);
    });

    it('returns defaults when stored stats are corrupt JSON', () => {
        localStorage.setItem('questcraft-usage-stats', '{not json');
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(statsService.getStats().totalInputTokens).toBe(0);
        expect(consoleSpy).toHaveBeenCalled();
    });

    it('accumulates tokens and recomputes cost from cumulative totals', () => {
        statsService.updateTokens({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
        // 1M in * $0.35/M + 1M out * $0.7/M
        expect(statsService.getStats().totalCost).toBeCloseTo(1.05, 5);

        statsService.updateTokens({ inputTokens: 1_000_000, outputTokens: 0 });
        // cumulative: 2M in * 0.35 + 1M out * 0.7
        expect(statsService.getStats().totalCost).toBeCloseTo(1.4, 5);
    });

    it('ignores undefined usage and all-zero usage', () => {
        statsService.updateTokens(undefined);
        statsService.updateTokens({ inputTokens: 0, outputTokens: 0 });
        expect(statsService.getStats().totalInputTokens).toBe(0);
    });

    it('treats NaN/invalid TOKEN_LIMIT env as the 1M default', () => {
        const prev = process.env.TOKEN_LIMIT;
        process.env.TOKEN_LIMIT = 'bogus';
        statsService.updateTokens({ inputTokens: 999_999, outputTokens: 0 });
        expect(statsService.isTokenLimitExceeded()).toBe(false);
        statsService.updateTokens({ inputTokens: 1, outputTokens: 0 });
        expect(statsService.isTokenLimitExceeded()).toBe(true);
        process.env.TOKEN_LIMIT = prev;
    });

    it('honors a valid TOKEN_LIMIT env override', () => {
        const prev = process.env.TOKEN_LIMIT;
        process.env.TOKEN_LIMIT = '100';
        statsService.updateTokens({ inputTokens: 100, outputTokens: 0 });
        expect(statsService.isTokenLimitExceeded()).toBe(true);
        expect(statsService.getTokenUsage()).toEqual({ used: 100, limit: 100 });
        process.env.TOKEN_LIMIT = prev;
    });

    it('increments time played and dispatches the update event', () => {
        const listener = vi.fn();
        window.addEventListener(STATS_UPDATED_EVENT, listener);
        statsService.incrementTimePlayed();
        expect(statsService.getStats().timePlayedInSeconds).toBe(1);
        expect(listener).toHaveBeenCalled();
        window.removeEventListener(STATS_UPDATED_EVENT, listener);
    });

    it('tracks web search requests, results and failures separately', () => {
        statsService.trackWebSearch(5, false);
        statsService.trackWebSearch(2, false);
        statsService.trackWebSearch(0, true);
        expect(statsService.getWebSearchStats()).toEqual({
            requests: 3,
            results: 7,
            failures: 1,
        });
    });

    it('resetStats zeroes everything and notifies', () => {
        statsService.updateTokens({ inputTokens: 10, outputTokens: 10 });
        statsService.resetStats();
        const stats = statsService.getStats();
        expect(stats.totalInputTokens).toBe(0);
        expect(stats.totalOutputTokens).toBe(0);
        expect(stats.totalCost).toBe(0);
    });
});

describe('auditLogService (issue #59 coverage)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    const sampleLog = () => ({
        mode: 'Chat' as const,
        model: 'test-model',
        prompt: 'hello',
        response: 'world',
    });

    it('addLog assigns id + timestamp and prepends newest first', () => {
        auditLogService.addLog(sampleLog());
        auditLogService.addLog(sampleLog());
        const logs = auditLogService.getLogs();
        expect(logs).toHaveLength(2);
        expect(logs[0].id).toBeTruthy();
        expect(logs[1].id).toBeTruthy();
        expect(new Date(logs[0].timestamp).getTime()).toBeGreaterThanOrEqual(
            new Date(logs[1].timestamp).getTime()
        );
    });

    it('returns [] when stored logs are corrupt', () => {
        localStorage.setItem('questcraft-ai-audit-log', 'garbage{');
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(auditLogService.getLogs()).toEqual([]);
        expect(consoleSpy).toHaveBeenCalled();
    });

    it('clearLogs empties the log and dispatches update event', () => {
        const listener = vi.fn();
        window.addEventListener(AUDIT_LOG_UPDATED_EVENT, listener);
        auditLogService.addLog(sampleLog());
        auditLogService.clearLogs();
        expect(auditLogService.getLogs()).toEqual([]);
        expect(listener).toHaveBeenCalled();
        window.removeEventListener(AUDIT_LOG_UPDATED_EVENT, listener);
    });
});

describe('gameStateService round-trip (issue #59 coverage)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    const state = () =>
        ({
            currentStageIndex: 2,
            questConfig: { name: { en: 'Q' } },
        }) as any;

    it('saves, loads and clears with schema versioning', () => {
        gameStateService.save(state());
        expect(gameStateService.load()).toMatchObject({ currentStageIndex: 2 });
        gameStateService.clear();
        expect(gameStateService.load()).toBeNull();
    });

    it('returns null when nothing was ever saved', () => {
        expect(gameStateService.load()).toBeNull();
    });
});

describe('getLocalizedString (issue #59 coverage)', () => {
    it('returns empty string for undefined/null/empty', () => {
        expect(getLocalizedString(undefined, 'en')).toBe('');
        expect(getLocalizedString('', 'en')).toBe('');
    });

    it('passes plain strings through', () => {
        expect(getLocalizedString('plain', 'ta')).toBe('plain');
    });

    it('prefers requested language, falls back to en, then first key', () => {
        const ls = { en: 'Hello', ta: 'வணக்கம்' };
        expect(getLocalizedString(ls, 'ta')).toBe('வணக்கம்');
        expect(getLocalizedString(ls, 'hi')).toBe('Hello');
        expect(getLocalizedString({ ta: 'only' }, 'hi')).toBe('only');
    });
});

describe('settingsService (issue #59 coverage)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it('returns defaults and never keeps an apiKey from storage', () => {
        localStorage.setItem(
            'questcraft-app-settings',
            JSON.stringify({
                ai: { providerId: 'gemini', model: 'gemini-2.5-flash', apiKey: 'sk-secret' },
                language: 'ta',
            })
        );
        const s = settingsService.getSettings();
        expect(s.language).toBe('ta');
        expect((s.ai as any).apiKey).toBeUndefined();
    });

    it('resets an unknown provider back to community', () => {
        localStorage.setItem(
            'questcraft-app-settings',
            JSON.stringify({ ai: { providerId: 'does-not-exist' }, language: 'en' })
        );
        expect(settingsService.getSettings().ai.providerId).toBe('community');
    });

    it('runs the v0→v1 migration and stamps the version on save', () => {
        localStorage.setItem(
            'questcraft-app-settings',
            JSON.stringify({ ai: { providerId: 'openai', apiKey: 'legacy' }, language: 'en' })
        );
        const s = settingsService.getSettings();
        expect((s.ai as any).apiKey).toBeUndefined();

        settingsService.saveSettings(s);
        const raw = JSON.parse(localStorage.getItem('questcraft-app-settings')!);
        expect(raw.settingsVersion).toBe(SETTINGS_VERSION);
    });

    it('saveAiSettings strips apiKey before persisting', () => {
        settingsService.saveAiSettings({
            providerId: 'openai',
            model: 'gpt-4o',
            baseUrl: 'https://api.openai.com/v1',
            aiRequestDelayMs: 1100,
            apiKey: 'should-not-persist',
        } as any);
        const raw = JSON.parse(localStorage.getItem('questcraft-app-settings')!);
        expect(raw.ai.apiKey).toBeUndefined();
        expect(raw.ai.providerId).toBe('openai');
    });

    it('language round-trips', () => {
        settingsService.saveLanguage('hi');
        expect(settingsService.getLanguage()).toBe('hi');
    });

    it('session API key round-trips and clears', () => {
        settingsService.saveSessionApiKey('sess-key');
        expect(settingsService.getSessionApiKey()).toBe('sess-key');
        settingsService.clearSessionApiKey();
        expect(settingsService.getSessionApiKey()).toBeNull();
    });

    it('env key lookup prefers provider-specific then generic API_KEY', async () => {
        const prev = { ...process.env };
        vi.resetModules();
        process.env.OPENAI_API_KEY = 'prov-key';
        process.env.API_KEY = 'generic';
        const fresh = await import('../services/settingsService');
        expect(fresh.getProviderApiKeyFromEnv('openai')).toBe('prov-key');
        delete process.env.OPENAI_API_KEY;
        expect(getProviderApiKeyFromEnv('openai')).toBe('generic');
        process.env.GEMINI_API_KEY = prev.GEMINI_API_KEY;
        delete process.env.API_KEY;
    });

    it('falls back to defaults on corrupt settings JSON', () => {
        localStorage.setItem('questcraft-app-settings', '{broken');
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(settingsService.getSettings()).toEqual(defaultSettings);
        expect(consoleSpy).toHaveBeenCalled();
    });
});
