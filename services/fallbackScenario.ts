import type {
    BoardLocation,
    LocalizedString,
    ManagedScenario,
    Player,
    QuestConfig,
} from '../types';
import { getLocalizedString } from '../utils/localization';

/**
 * Deterministic, offline-safe scenario builder used when the AI provider
 * fails AND the quest ships no pre-generated scenarios for a location.
 * Keeps the current turn playable instead of deadlocking the game in an
 * error state (issue #78).
 *
 * Language coverage mirrors the app's supported language list; unknown
 * languages naturally fall back to 'en' via getLocalizedString.
 */

const TITLES: Record<string, (loc: string) => string> = {
    en: (loc) => `Unexpected Detour at ${loc}`,
    es: (loc) => `Desvío inesperado en ${loc}`,
    hi: (loc) => `${loc} पर अनपेक्षित मोड़`,
    ta: (loc) => `${loc}இல் எதிர்பாராத திருப்பம்`,
};

const DESCRIPTIONS: Record<string, (loc: string, player: string) => string> = {
    en: (loc, player) =>
        `A routine visit to ${loc} takes an unplanned turn. Weigh your options carefully, ${player}.`,
    es: (loc, player) =>
        `Una visita de rutina a ${loc} toma un giro inesperado. Sopesa tus opciones, ${player}.`,
    hi: (loc, player) =>
        `${loc} की एक साधारण यात्रा अनपेक्षित रूप से मुड़ जाती है। अपने विकल्पों पर विचार करें, ${player}.`,
    ta: (loc, player) =>
        `${loc}க்கான வழக்கமான வருகை எதிர்பாராத திருப்பத்தை எடுக்கிறது. உங்கள் விருப்பங்களை கவனமாக எடைபோடுங்கள், ${player}.`,
};

const SAFE_CHOICE_TEXT: Record<string, string> = {
    en: 'Play it safe',
    es: 'Jugar seguro',
    hi: 'सुरक्षित रहें',
    ta: 'பாதுகாப்பாக விளையாடு',
};

const RISKY_CHOICE_TEXT: Record<string, string> = {
    en: 'Take the risk',
    es: 'Asumir el riesgo',
    hi: 'जोखिम उठाएँ',
    ta: 'இடரை ஏற்றுக்கொள்',
};

const SAFE_EXPLANATION: Record<string, (r: string) => string> = {
    en: (r) => `You proceed cautiously. It costs you a little ${r}.`,
    es: (r) => `Procedes con cautela. Te cuesta un poco de ${r}.`,
    hi: (r) => `आप सावधानी से आगे बढ़ते हैं। इसमें थोड़ा ${r} खर्च होता है।`,
    ta: (r) => `நீங்கள் எச்சரிக்கையாக முன்னேறுகிறீர்கள். இதற்கு சற்று ${r} செலவாகும்.`,
};

const RISKY_EXPLANATION: Record<string, (gain: string, loss: string) => string> = {
    en: (gain, loss) => `You push your luck: a solid ${gain} boost, but it drains ${loss}.`,
    es: (gain, loss) => `Arriesgas: una buena mejora de ${gain}, pero agota ${loss}.`,
    hi: (gain, loss) => `आप जोखिम लेते हैं: ${gain} में अच्छी वृद्धि, लेकिन ${loss} खर्च होता है।`,
    ta: (gain, loss) => `நீங்கள் இடர் எடுக்கிறீர்கள்: ${gain} நல்ல அதிகரிப்பு, ஆனால் ${loss} குறைகிறது.`,
};

const localize = (
    templates: Record<string, (...args: string[]) => string>,
    ...args: string[]
): LocalizedString =>
    Object.fromEntries(Object.entries(templates).map(([lang, fn]) => [lang, fn(...args)]));

export const buildFallbackScenario = (
    questConfig: QuestConfig,
    player: Player,
    location: BoardLocation
): ManagedScenario => {
    const locationName = getLocalizedString(location.name, 'en');
    const playerName = player.name || 'Player';

    const resourceNames = questConfig.resources
        .slice(0, 2)
        .map((r) => getLocalizedString(r.name, 'en').toLowerCase());
    const gainResource = resourceNames[0] ?? 'resources';
    const lossResource = resourceNames[1] ?? gainResource;

    return {
        id: `fallback-${locationName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: localize(TITLES, locationName),
        description: localize(DESCRIPTIONS, locationName, playerName),
        choices: [
            {
                text: { ...SAFE_CHOICE_TEXT },
                outcome: {
                    explanation: localize(SAFE_EXPLANATION, gainResource),
                    resourceChanges: [{ name: gainResource, value: -5 }],
                },
            },
            {
                text: { ...RISKY_CHOICE_TEXT },
                outcome: {
                    explanation: localize(RISKY_EXPLANATION, gainResource, lossResource),
                    resourceChanges: [
                        { name: gainResource, value: 12 },
                        { name: lossResource, value: -8 },
                    ],
                },
            },
        ],
        sourceTitle: { en: 'Offline fallback scenario' },
        custom: false,
        enabled: true,
    };
};
