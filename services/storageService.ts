import { logger } from './logger';

/**
 * Centralized safe storage access. All localStorage/sessionStorage access in the
 * app should go through these helpers so that quota errors (private browsing,
 * full storage) degrade gracefully instead of throwing mid-game. (issue #55)
 */

export const CURRENT_SCHEMA_VERSION = 1;

export function safeGetItem(storage: Storage, key: string): string | null {
    try {
        return storage.getItem(key);
    } catch (e) {
        logger.error(`[Storage] Failed to read "${key}"`, e);
        return null;
    }
}

export function safeSetItem(storage: Storage, key: string, value: string): boolean {
    try {
        storage.setItem(key, value);
        return true;
    } catch (e: any) {
        const isQuota = e?.name === 'QuotaExceededError' || e?.code === 22 || e?.code === 1014;
        logger.error(
            isQuota
                ? `[Storage] Quota exceeded while saving "${key}". Changes will not persist.`
                : `[Storage] Failed to save "${key}"`,
            e
        );
        return false;
    }
}

export function safeRemoveItem(storage: Storage, key: string): void {
    try {
        storage.removeItem(key);
    } catch (e) {
        logger.error(`[Storage] Failed to remove "${key}"`, e);
    }
}

export interface VersionedPayload<T> {
    schemaVersion: number;
    data: T;
}

/** Wraps arbitrary data in a versioned envelope before persisting. */
export function setVersionedItem<T>(storage: Storage, key: string, data: T): boolean {
    const payload: VersionedPayload<T> = { schemaVersion: CURRENT_SCHEMA_VERSION, data };
    return safeSetItem(storage, key, JSON.stringify(payload));
}

/**
 * Reads a versioned envelope. Returns null (caller should treat as "no data")
 * when the record is missing, corrupt, or written by an incompatible schema version.
 */
export function getVersionedItem<T>(storage: Storage, key: string): T | null {
    const raw = safeGetItem(storage, key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed) {
            if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
                logger.warn(`[Storage] "${key}" has schemaVersion ${parsed.schemaVersion}, expected ${CURRENT_SCHEMA_VERSION}. Discarding stale data.`);
                safeRemoveItem(storage, key);
                return null;
            }
            return ('data' in parsed ? parsed.data : parsed) as T;
        }
        // Legacy (pre-versioning) payload without an envelope: accept as-is so progress isn't wiped.
        return parsed as T;
    } catch (e) {
        logger.error(`[Storage] Failed to parse "${key}"`, e);
        return null;
    }
}
