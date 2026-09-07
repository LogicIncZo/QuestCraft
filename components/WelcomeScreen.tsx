import React, { useState, useCallback } from 'react';
import type { QuestConfig, LoadedQuest } from '../types';
import { useTranslation } from '../services/i18n';
import { getLocalizedString } from '../utils/localization';

interface WelcomeScreenProps {
    customQuests: QuestConfig[];
    defaultQuests: LoadedQuest[];
    onLoadQuest: (config: QuestConfig, fromUserAction?: boolean) => void;
    isMakerModeEnabled: boolean;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
    customQuests,
    defaultQuests,
    onLoadQuest,
    isMakerModeEnabled,
}) => {
    const { t, language } = useTranslation();
    const [jsonInput, setJsonInput] = useState('');
    const [urlInput, setUrlInput] = useState('');
    const [jsonError, setJsonError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleLoadFromUrl = useCallback(async () => {
        if (!urlInput) {
            setJsonError('Please paste a URL.');
            return;
        }

        setIsLoading(true);
        setJsonError('');

        try {
            let questConfigUrl = urlInput;
            const gistIdMatch = urlInput.match(
                /(?:https?:\/\/)?gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]+)/
            );
            if (gistIdMatch?.[1]) {
                const gistId = gistIdMatch[1];
                const apiResponse = await fetch(`https://api.github.com/gists/${gistId}`);
                if (!apiResponse.ok)
                    throw new Error(`GitHub API error! status: ${apiResponse.status}`);
                const gistData = await apiResponse.json();
                const jsonFile = Object.values(gistData.files).find((file: any) =>
                    file.filename.endsWith('.json')
                ) as { raw_url: string } | undefined;
                if (!jsonFile?.raw_url) throw new Error('No .json file found in this Gist.');
                questConfigUrl = jsonFile.raw_url;
            }

            const questResponse = await fetch(questConfigUrl);
            if (!questResponse.ok)
                throw new Error(`Failed to fetch quest from URL: ${questResponse.status}`);
            const config = await questResponse.json();

            if (config.name && config.board && config.resources) {
                onLoadQuest(config, true);
                setJsonError('');
            } else {
                throw new Error('Invalid quest format from URL. Missing required fields.');
            }
        } catch (e: any) {
            console.error(e);
            setJsonError(`Failed to load quest from URL: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [urlInput, onLoadQuest]);

    const handleJsonLoad = () => {
        try {
            const parsed = JSON.parse(jsonInput);
            if (parsed.name && parsed.board && parsed.resources) {
                onLoadQuest(parsed, true);
                setJsonError('');
            } else {
                setJsonError('Invalid quest format. Missing required fields.');
            }
        } catch (error) {
            setJsonError('Invalid JSON. Please check the syntax.');
        }
    };

    const inputClass =
        'bg-felt-900 border border-felt-600 rounded-lg text-paper placeholder:text-sage/60 focus:border-brass focus:outline-none transition-colors';

    return (
        <div className="min-h-full flex flex-col justify-center p-4 md:p-8">
            <div className="w-full max-w-7xl mx-auto relative">
                {isLoading && (
                    <div className="absolute inset-0 bg-felt-900/80 flex items-center justify-center rounded-2xl z-10">
                        <p className="text-paper text-lg animate-pulse">{t('loadingQuest')}</p>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
                    {/* Left Side: Load */}
                    <div className="lg:col-span-2 space-y-8">
                        <div className="space-y-6">
                            <div>
                                <h3 className="font-display font-bold text-lg text-paper mb-2">
                                    {t('loadFromUrl')}
                                </h3>
                                <div className="flex gap-2">
                                    <input
                                        value={urlInput}
                                        onChange={(e) => setUrlInput(e.target.value)}
                                        className={`flex-grow p-2 font-mono text-sm ${inputClass}`}
                                        placeholder={t('urlPlaceholder')}
                                        aria-label={t('urlPlaceholder')}
                                    />
                                    <button
                                        onClick={handleLoadFromUrl}
                                        className="bg-felt-700 hover:bg-felt-600 text-paper font-bold py-2 px-4 rounded-lg transition-colors"
                                    >
                                        {t('load')}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <h3 className="font-display font-bold text-lg text-paper mb-2">
                                    {t('orPasteJson')}
                                </h3>
                                <textarea
                                    value={jsonInput}
                                    onChange={(e) => setJsonInput(e.target.value)}
                                    className={`w-full h-24 p-2 font-mono text-sm ${inputClass}`}
                                    placeholder={t('jsonPlaceholder')}
                                    aria-label={t('jsonPlaceholder')}
                                />
                                <button
                                    onClick={handleJsonLoad}
                                    className="w-full mt-2 bg-brass hover:bg-brass-bright text-felt-900 font-bold py-2 px-4 rounded-lg transition-colors"
                                >
                                    {t('loadFromJson')}
                                </button>
                            </div>
                            {jsonError && (
                                <p className="text-clay text-sm mt-1" role="alert">
                                    {jsonError}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Right Side: Quest List */}
                    <div className="lg:col-span-3">
                        <h2 className="text-2xl font-bold font-display tracking-tight text-paper mb-4">
                            {t('playAQuest')}
                        </h2>
                        <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-2">
                            {customQuests.map((quest) => (
                                <button
                                    key={getLocalizedString(quest.name, 'en')}
                                    onClick={() => onLoadQuest(quest, false)}
                                    className="w-full text-left p-4 bg-felt-800 hover:bg-felt-700 border border-felt-700 hover:border-felt-500 rounded-lg transition-colors"
                                >
                                    <div className="flex justify-between items-center gap-3">
                                        <h3 className="font-display font-bold text-lg text-paper">
                                            {getLocalizedString(quest.name, language)}
                                        </h3>
                                        <span className="text-xs font-bold bg-brass text-felt-900 px-2 py-1 rounded-full flex-shrink-0">
                                            {t('custom')}
                                        </span>
                                    </div>
                                    <p className="text-sm text-sage mt-1 leading-relaxed">
                                        {getLocalizedString(quest.description, language)}
                                    </p>
                                </button>
                            ))}
                            {defaultQuests.map((quest) => (
                                <button
                                    key={quest.filePath}
                                    onClick={() => onLoadQuest(quest.config, false)}
                                    className="w-full text-left p-4 bg-felt-800 hover:bg-felt-700 border border-felt-700 hover:border-felt-500 rounded-lg transition-colors"
                                >
                                    <h3 className="font-display font-bold text-lg text-paper">
                                        {getLocalizedString(quest.config.name, language)}
                                    </h3>
                                    <p className="text-sm text-sage mt-1 leading-relaxed">
                                        {getLocalizedString(quest.config.description, language)}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WelcomeScreen;
