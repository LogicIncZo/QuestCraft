import type { GameState } from '../types';
import { logger } from './logger';
import {
    safeSetItem,
    safeGetItem,
    safeRemoveItem,
    setVersionedItem,
    getVersionedItem,
} from './storageService';

const GAME_STATE_KEY = 'questcraft-game-state';

export const gameStateService = {
    save(state: GameState): void {
        logger.info('[GameState] Saving game state to localStorage.');
        logger.debug('[GameState] State being saved:', state);
        const persisted = setVersionedItem(localStorage, GAME_STATE_KEY, state);
        if (!persisted) {
            logger.error(
                '[GameState] Game state could not be persisted (storage unavailable or full). Progress is kept in memory for this session only.'
            );
        }
    },

    load(): GameState | null {
        const state = getVersionedItem<GameState>(localStorage, GAME_STATE_KEY);
        if (state) {
            logger.info('[GameState] Loaded game state from localStorage.');
            logger.debug('[GameState] Loaded state:', state);
            return state;
        }
        if (safeGetItem(localStorage, GAME_STATE_KEY) === null) {
            logger.info('[GameState] No game state found in localStorage.');
        }
        return null;
    },

    clear(): void {
        logger.info('[GameState] Clearing game state from localStorage.');
        safeRemoveItem(localStorage, GAME_STATE_KEY);
    },
};
