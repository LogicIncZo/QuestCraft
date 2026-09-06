import React from 'react';
import type { Board, Player, LanguageCode } from '../types';
import { BoardLocationType } from '../types';
import {
    JailIcon,
    FreeParkingIcon,
    GoToJailIcon,
    StartIcon,
    ChanceIcon,
    CommunityChestIcon,
    TaxIcon,
    UtilityIcon,
} from '../constants';
import { getLocalizedString } from '../utils/localization';

interface GameBoardProps {
    board: Board;
    players: Player[];
    questName: string;
    language: LanguageCode;
}

const getGridPosition = (index: number, total: number) => {
    const sideLength = total / 4;
    // Bottom row (right to left)
    if (index >= 0 && index < sideLength) {
        return { gridColumn: `${sideLength - index}`, gridRow: `${sideLength + 1}` };
    }
    // Left column (bottom to top)
    if (index >= sideLength && index < sideLength * 2) {
        return { gridColumn: '1', gridRow: `${sideLength * 2 - index}` };
    }
    // Top row (left to right)
    if (index >= sideLength * 2 && index < sideLength * 3) {
        return { gridColumn: `${index - sideLength * 2 + 2}`, gridRow: '1' };
    }
    // Right column (top to bottom)
    if (index >= sideLength * 3 && index < total) {
        return { gridColumn: `${sideLength + 1}`, gridRow: `${index - sideLength * 3 + 2}` };
    }
    return {};
};

const LocationContent = ({ location }: { location: Board['locations'][0] }) => {
    const baseIconClass = 'w-4 h-4 sm:w-5 sm:h-5 md:w-7 md:h-7 mx-auto opacity-80';
    switch (location.type) {
        case BoardLocationType.START:
            return <StartIcon className={baseIconClass} />;
        case BoardLocationType.JAIL:
            return <JailIcon className={baseIconClass} />;
        case BoardLocationType.FREE_PARKING:
            return <FreeParkingIcon className={baseIconClass} />;
        case BoardLocationType.GO_TO_JAIL:
            return <GoToJailIcon className={baseIconClass} />;
        case BoardLocationType.CHANCE:
            return <ChanceIcon className={baseIconClass} />;
        case BoardLocationType.COMMUNITY_CHEST:
            return <CommunityChestIcon className={baseIconClass} />;
        case BoardLocationType.TAX:
            return <TaxIcon className={baseIconClass} />;
        case BoardLocationType.UTILITY:
            return <UtilityIcon className={baseIconClass} />;
        default:
            return null;
    }
};

const GameBoard: React.FC<GameBoardProps> = ({ board, players, questName, language }) => {
    const totalLocations = board.locations.length;
    const sideLength = totalLocations / 4;
    // minmax(0, 1fr) keeps tile content from inflating tracks beyond the board
    const track = 'minmax(0, 1fr)';
    const gridTemplateColumns = `1.5fr repeat(${sideLength - 1}, ${track}) 1.5fr`;
    const gridTemplateRows = `1.5fr repeat(${sideLength - 1}, ${track}) 1.5fr`;

    return (
        <div className="aspect-square w-full max-w-[80vh] max-h-full mx-auto p-2 md:p-4 bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
            <div
                className="relative grid h-full w-full gap-1"
                style={{ gridTemplateColumns, gridTemplateRows }}
            >
                {/* Board Locations */}
                {board.locations.map((location, index) => {
                    const isCorner = index % sideLength === 0;
                    const positionStyle = getGridPosition(index, totalLocations);
                    const locationId = `location-${index}`;
                    return (
                        <div
                            key={locationId}
                            id={locationId}
                            style={positionStyle}
                            className={`relative flex flex-col justify-between p-1 md:p-1.5 rounded-md shadow-inner bg-gray-200 text-gray-800 text-center overflow-hidden ${isCorner ? 'items-center justify-center' : ''}`}
                        >
                            {location.type === 'PROPERTY' && location.color && (
                                <div
                                    className={`h-2.5 md:h-4 w-full ${location.color} rounded-t-sm -mx-1 -mt-1 md:-mx-1.5 md:-mt-1.5 mb-1`}
                                ></div>
                            )}
                            <div
                                className={`flex-grow flex flex-col min-h-0 ${isCorner ? 'justify-center items-center' : 'justify-start'}`}
                            >
                                <p className="text-[7px] sm:text-[8px] md:text-[10px] font-bold uppercase leading-tight tracking-tighter break-words">
                                    {getLocalizedString(location.name, language)}
                                </p>
                                {isCorner && (
                                    <div className="mt-1">
                                        <LocationContent location={location} />
                                    </div>
                                )}
                            </div>
                            {!isCorner && (
                                <div className="mt-1 shrink-0">
                                    <LocationContent location={location} />
                                </div>
                            )}

                            {/* Player Tokens */}
                            <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-1 p-1 pointer-events-none">
                                {players
                                    .filter((p) => p.position === index && !p.isBankrupt)
                                    .map((p) => (
                                        <div
                                            key={`token-${p.id}`}
                                            role="img"
                                            aria-label={p.name}
                                            className={`w-3.5 h-3.5 md:w-5 md:h-5 rounded-full ${p.color} bg-current border-2 border-white shadow-lg animate-token-move`}
                                            style={{ animationDelay: `${p.id * 100}ms` }}
                                            title={p.name}
                                        />
                                    ))}
                            </div>
                        </div>
                    );
                })}

                {/* Center Area */}
                <div
                    className="flex flex-col items-center justify-center bg-gray-900/50 rounded-lg shadow-xl min-h-0 min-w-0 p-2"
                    style={{
                        gridColumn: `2 / ${sideLength + 1}`,
                        gridRow: `2 / ${sideLength + 1}`,
                    }}
                >
                    <div
                        aria-hidden="true"
                        className="text-2xl sm:text-4xl md:text-5xl font-bold font-mono text-center text-orange-400 transform -rotate-6 max-w-full leading-tight"
                    >
                        {questName}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GameBoard;
