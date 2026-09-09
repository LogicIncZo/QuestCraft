import { describe, it, expect, vi, afterEach } from 'vitest';

type LoggerInstance = {
    level: number;
    finest: (...a: unknown[]) => void;
    debug: (...a: unknown[]) => void;
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
};

// The logger configures itself in its constructor, so each scenario needs a
// fresh module instance loaded under stubbed env vars.
async function loadLogger(): Promise<LoggerInstance> {
    vi.resetModules();
    const mod = await import('../services/logger');
    return mod.logger as unknown as LoggerInstance;
}

function outputText(log: unknown[][]): string {
    return log.map((args) => args.join(' ')).join('\n');
}

describe('logger (level filtering)', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('non-dev mode: only WARN and above reach the console', async () => {
        vi.stubEnv('DEV_MODE', '');
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const log = await loadLogger();
        log.finest('f');
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        const text = outputText(logSpy.mock.calls as unknown as unknown[][]);
        expect(text).toContain('[WARN]');
        expect(text).toContain('[ERROR]');
        expect(text).not.toContain('[INFO]');
        expect(text).not.toContain('[DEBUG]');
        expect(text).not.toContain('[FINEST]');
    });

    it('dev mode with DEBUG level emits debug but suppresses finest', async () => {
        vi.stubEnv('DEV_MODE', 'true');
        vi.stubEnv('DEBUG_LEVEL', 'DEBUG');
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const log = await loadLogger();
        log.finest('f');
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        const text = outputText(logSpy.mock.calls as unknown as unknown[][]);
        expect(text).toContain('[DEBUG]');
        expect(text).not.toContain('[FINEST]');
    });

    it('dev mode with FINEST level emits everything including finest', async () => {
        vi.stubEnv('DEV_MODE', 'true');
        vi.stubEnv('DEBUG_LEVEL', 'FINEST');
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const log = await loadLogger();
        log.finest('f');
        log.debug('d');
        const text = outputText(logSpy.mock.calls as unknown as unknown[][]);
        expect(text).toContain('[FINEST]');
        expect(text).toContain('[DEBUG]');
    });

    it('dev mode with an invalid DEBUG_LEVEL falls back to INFO', async () => {
        vi.stubEnv('DEV_MODE', 'true');
        vi.stubEnv('DEBUG_LEVEL', 'NOT_A_LEVEL');
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const log = await loadLogger();
        expect(log.level).toBe(3); // LogLevel.INFO
        log.info('i');
        log.debug('d');
        const text = outputText(logSpy.mock.calls as unknown as unknown[][]);
        expect(text).toContain('[INFO]');
        expect(text).not.toContain('[DEBUG]');
    });

    it('dev mode without DEBUG_LEVEL defaults to INFO', async () => {
        vi.stubEnv('DEV_MODE', 'true');
        vi.stubEnv('DEBUG_LEVEL', '');
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const log = await loadLogger();
        expect(log.level).toBe(3);
    });

    it('OFF level suppresses even errors', async () => {
        vi.stubEnv('DEV_MODE', 'true');
        vi.stubEnv('DEBUG_LEVEL', 'OFF');
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const log = await loadLogger();
        log.error('e');
        const text = outputText(logSpy.mock.calls as unknown as unknown[][]);
        // The DEV_MODE startup banner is allowed; the error line itself is not.
        expect(text).not.toContain('[ERROR]');
    });

    it('every emitted line carries an ISO timestamp and level tag', async () => {
        vi.stubEnv('DEV_MODE', 'true');
        vi.stubEnv('DEBUG_LEVEL', 'INFO');
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const log = await loadLogger();
        log.warn('check-format');
        const calls = logSpy.mock.calls as unknown as string[][];
        const warnCall = calls.find((c) => c.some((a) => String(a).includes('check-format')));
        expect(warnCall).toBeDefined();
        expect(warnCall![0]).toMatch(
            /%c\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[WARN\]/
        );
        // extra args are passed through untouched
        expect(warnCall).toContain('check-format');
    });
});
