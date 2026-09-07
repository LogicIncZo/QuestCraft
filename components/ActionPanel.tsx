import React, { useState, useEffect } from 'react';
import type {
    Player,
    GamePhase,
    ManagedScenario,
    Choice,
    ChanceCard,
    LanguageCode,
} from '../types';
import { getLocalizedString } from '../utils/localization';
import { useTranslation } from '../services/i18n';

// Cards are drawn from a deck and laid on the felt: printed paper with a
// deed-style color band encoding the card type (chance, chest, scenario...).
const ActionCard: React.FC<{ children: React.ReactNode; title: string; band?: string }> = ({
    children,
    title,
    band,
}) => (
    <div className="bg-paper text-ink rounded-lg border border-ink/10 shadow-xl animate-fade-in flex flex-col h-full overflow-hidden">
        {band && <div className={`h-2.5 w-full ${band} flex-shrink-0`}></div>}
        <div className="p-6 flex flex-col flex-grow min-h-0">
            <h3 className="text-xl font-bold font-display tracking-tight text-felt-700 mb-4">
                {title}
            </h3>
            <div className="text-ink/90 space-y-4 flex-grow overflow-y-auto">{children}</div>
        </div>
    </div>
);

const CardButton: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({
    children,
    onClick,
}) => (
    <button
        onClick={onClick}
        className="w-full bg-felt-700 hover:bg-felt-600 text-paper font-bold py-3 px-4 rounded-lg transition-colors"
    >
        {children}
    </button>
);

interface ActionPanelProps {
    players: Player[];
    currentPlayer: Player;
    gamePhase: GamePhase;
    diceResult: [number, number] | null;
    activeScenario: ManagedScenario | null;
    activeChoiceOutcome: Choice['outcome'] | null;
    activeCard: ChanceCard | null;
    gameError: string | null;
    onRollDice: () => void;
    onScenarioChoice: (choice: Choice) => void;
    onNextTurn: () => void;
    onSelectScenarioSource: (source: 'pregen' | 'dynamic') => void;
    language: LanguageCode;
}

const ActionPanel: React.FC<ActionPanelProps> = ({
    players,
    currentPlayer,
    gamePhase,
    diceResult,
    activeScenario,
    activeChoiceOutcome,
    activeCard,
    gameError,
    onRollDice,
    onScenarioChoice,
    onNextTurn,
    onSelectScenarioSource,
    language,
}) => {
    const { t } = useTranslation();
    const [loadingMessage, setLoadingMessage] = useState<string>('');

    useEffect(() => {
        if (gamePhase === 'GENERATING_SCENARIO') {
            const loadingMessages = [
                t('generatingScenario'),
                t('aiConnecting'),
                t('aiCrafting'),
                t('aiInspiration'),
                t('aiPatience'),
            ];

            let messageIndex = 0;
            setLoadingMessage(loadingMessages[messageIndex]);

            const interval = setInterval(() => {
                messageIndex = (messageIndex + 1) % loadingMessages.length;
                setLoadingMessage(loadingMessages[messageIndex]);
            }, 3000); // Change message every 3 seconds

            return () => clearInterval(interval);
        }
    }, [gamePhase, t]);

    const renderContent = () => {
        if (gameError) {
            return (
                <ActionCard title={t('error')} band="bg-clay">
                    <p className="text-clay-deep">{gameError}</p>
                    <CardButton onClick={onNextTurn}>{t('continue')}</CardButton>
                </ActionCard>
            );
        }

        if (gamePhase === 'GAME_OVER') {
            const winner = players.find((p) => !p.isBankrupt);
            return (
                <ActionCard title={t('gameOver')} band="bg-brass">
                    <p className="text-lg text-center">
                        {t('gameOverMessage', { winnerName: winner?.name || '' })}
                    </p>
                    <CardButton onClick={() => window.location.reload()}>
                        {t('playAgain')}
                    </CardButton>
                </ActionCard>
            );
        }

        if (activeChoiceOutcome) {
            return (
                <ActionCard title={t('outcome')} band="bg-brass">
                    <p>{getLocalizedString(activeChoiceOutcome.explanation, language)}</p>
                    <CardButton onClick={onNextTurn}>{t('endTurn')}</CardButton>
                </ActionCard>
            );
        }

        if (activeScenario && gamePhase === 'SCENARIO_CHOICE') {
            if (currentPlayer.isAI) {
                return (
                    <ActionCard
                        title={getLocalizedString(activeScenario.title, language)}
                        band="bg-felt-500"
                    >
                        <p className="flex-grow overflow-y-auto">
                            {getLocalizedString(activeScenario.description, language)}
                        </p>
                        <div className="text-center p-4">
                            <p className="text-lg animate-pulse text-ink/60">
                                {t('aiIsThinking')}
                            </p>
                        </div>
                    </ActionCard>
                );
            }

            return (
                <ActionCard
                    title={getLocalizedString(activeScenario.title, language)}
                    band="bg-felt-500"
                >
                    <p className="flex-grow overflow-y-auto">
                        {getLocalizedString(activeScenario.description, language)}
                    </p>
                    {activeScenario.sourceUrl && (
                        <a
                            href={activeScenario.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brass-deep hover:underline text-sm block mt-2"
                        >
                            {t('source', {
                                sourceTitle:
                                    getLocalizedString(activeScenario.sourceTitle, language) ||
                                    activeScenario.sourceUrl,
                            })}
                        </a>
                    )}
                    <div className="flex flex-col space-y-3 pt-2">
                        {activeScenario.choices.map((choice, index) => (
                            <button
                                key={index}
                                onClick={() => onScenarioChoice(choice)}
                                className="w-full text-left bg-felt-900/5 hover:bg-felt-900/10 border border-ink/15 hover:border-felt-600 text-ink font-semibold py-3 px-4 rounded-lg transition-colors"
                            >
                                {getLocalizedString(choice.text, language)}
                            </button>
                        ))}
                    </div>
                </ActionCard>
            );
        }

        if (gamePhase === 'SCENARIO_SOURCE_SELECTION') {
            return (
                <ActionCard title={t('choosePath')} band="bg-felt-500">
                    <p className="text-center">{t('choosePathDescription')}</p>
                    <div className="flex flex-col space-y-3 pt-4">
                        <button
                            onClick={() => onSelectScenarioSource('pregen')}
                            className="w-full bg-brass hover:bg-brass-bright text-felt-900 font-bold py-3 px-4 rounded-lg transition-colors"
                        >
                            {t('playStoryScenario')}
                        </button>
                        <button
                            onClick={() => onSelectScenarioSource('dynamic')}
                            className="w-full bg-felt-700 hover:bg-felt-600 text-paper font-bold py-3 px-4 rounded-lg transition-colors"
                        >
                            {t('generateDynamicEvent')}
                        </button>
                    </div>
                </ActionCard>
            );
        }

        if (activeCard && (gamePhase === 'CHANCE_CARD' || gamePhase === 'COMMUNITY_CHEST_CARD')) {
            const isChance = gamePhase === 'CHANCE_CARD';
            return (
                <ActionCard
                    title={isChance ? 'Chance' : 'Community Chest'}
                    band={isChance ? 'bg-amber-500' : 'bg-sky-600'}
                >
                    <p className="text-lg text-center font-medium">
                        "{getLocalizedString(activeCard.description, language)}"
                    </p>
                    <CardButton onClick={onNextTurn}>{t('continue')}</CardButton>
                </ActionCard>
            );
        }

        if (gamePhase === 'GENERATING_SCENARIO') {
            return (
                <div className="text-center space-y-4 flex flex-col justify-center items-center h-full">
                    <p className="text-lg animate-pulse text-sage">{loadingMessage}</p>
                </div>
            );
        }

        return (
            <div className="flex flex-col justify-center items-center h-full space-y-4">
                {diceResult && (
                    <p className="text-lg text-paper">
                        {t('youRolled', { roll: diceResult[0] + diceResult[1] })}
                    </p>
                )}
                <button
                    onClick={onRollDice}
                    disabled={gamePhase !== 'TURN_START' || currentPlayer.isAI}
                    className="w-full bg-brass hover:bg-brass-bright disabled:bg-felt-700 disabled:text-sage/50 disabled:cursor-not-allowed text-felt-900 font-bold py-3 px-4 rounded-lg transition-colors"
                >
                    {t('rollDice')}
                </button>
            </div>
        );
    };

    return (
        <div className="w-full h-full bg-felt-800 p-4 md:p-6 rounded-xl border border-felt-700 flex flex-col">
            {renderContent()}
        </div>
    );
};

export default ActionPanel;
