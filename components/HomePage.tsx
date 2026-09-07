import React from 'react';
import type { Page } from '../types';
import { useTranslation } from '../services/i18n';
import { PlayIcon, MakerIcon } from '../constants';

interface HomePageProps {
    onNavigate: (page: Page) => void;
    isMakerModeEnabled: boolean;
}

// The two modes are rendered as game components laid on the table: paper tiles
// with a deed-style color band, like the property cards they will play with.
const ModeTile = ({
    title,
    description,
    icon,
    onClick,
    bandClass,
}: {
    title: string;
    description: string;
    icon: React.ReactNode;
    onClick: () => void;
    bandClass: string;
}) => (
    <button
        onClick={onClick}
        className="group text-left bg-paper text-ink rounded-lg overflow-hidden border border-ink/10 shadow-lg transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl focus-visible:-translate-y-1"
    >
        <div className={`h-3 w-full ${bandClass}`}></div>
        <div className="p-6 md:p-8">
            <div className="flex items-center gap-4 mb-4">
                <div className="text-felt-700">{icon}</div>
                <h3 className="text-2xl md:text-3xl font-bold font-display tracking-tight">
                    {title}
                </h3>
            </div>
            <p className="text-ink/80 leading-relaxed">{description}</p>
        </div>
    </button>
);

const HomePage: React.FC<HomePageProps> = ({ onNavigate, isMakerModeEnabled }) => {
    const { t } = useTranslation();
    return (
        <div className="h-full flex flex-col justify-center">
            <div className="w-full max-w-5xl mx-auto px-6 py-10 md:py-14">
                <h1 className="text-5xl md:text-7xl font-extrabold font-display tracking-tight text-paper mb-5">
                    {t('questCraftTitle')}
                </h1>
                <p className="text-lg md:text-xl text-sage max-w-2xl leading-relaxed mb-12">
                    {t('welcomeScreenLead')}{' '}
                    <button
                        onClick={() => onNavigate('docs')}
                        className="text-brass-bright hover:underline underline-offset-4"
                    >
                        {t('welcomeScreenLeadLink')}
                    </button>
                </p>
                <h2 className="text-xl font-bold text-paper mb-5 font-display tracking-tight">
                    {t('homeTitle')}
                </h2>
                <div
                    className={`grid grid-cols-1 ${isMakerModeEnabled ? 'md:grid-cols-2' : ''} gap-6 max-w-3xl`}
                >
                    <ModeTile
                        onClick={() => onNavigate('welcome')}
                        title={t('playerMode')}
                        description={t('playerModeDescription')}
                        icon={<PlayIcon className="w-8 h-8" />}
                        bandClass="bg-felt-500"
                    />
                    {isMakerModeEnabled && (
                        <ModeTile
                            onClick={() => onNavigate('maker')}
                            title={t('makerMode')}
                            description={t('makerModeDescription')}
                            icon={<MakerIcon className="w-8 h-8" />}
                            bandClass="bg-brass"
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default HomePage;
