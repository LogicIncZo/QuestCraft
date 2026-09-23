import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../services/i18n';

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
}

const EXIT_ANIMATION_MS = 300;
const TITLE_ID = 'confirm-dialog-title';
const MESSAGE_ID = 'confirm-dialog-message';

const getFocusable = (): HTMLElement[] =>
    Array.from<HTMLElement>(
        document.querySelector<HTMLElement>('[data-confirm-panel]')?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
    ).filter((el: HTMLElement) => !el.hasAttribute('disabled'));

const ConfirmDialog: React.FC<{
    options: ConfirmOptions;
    visible: boolean;
    panelRef: React.RefObject<HTMLDivElement | null>;
    onSettle: (result: boolean) => void;
}> = ({ options, visible, panelRef, onSettle }) => {
    const { t } = useTranslation();

    return (
        <div
            className={`fixed inset-0 z-[60] flex items-center justify-center p-4 transition-opacity duration-300 ease-in-out ${
                visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={options.title ? TITLE_ID : MESSAGE_ID}
            aria-describedby={MESSAGE_ID}
        >
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => onSettle(false)}
                aria-hidden="true"
            />

            <div
                ref={panelRef}
                data-confirm-panel
                className={`relative w-full max-w-md bg-felt-800 border border-felt-700 shadow-2xl rounded-lg transform transition-transform duration-300 ease-in-out ${
                    visible ? 'scale-100' : 'scale-95'
                }`}
            >
                {options.title && (
                    <header className="p-4 md:p-5 border-b border-felt-700">
                        <h2 id={TITLE_ID} className="text-xl font-bold font-display tracking-tight text-paper">
                            {options.title}
                        </h2>
                    </header>
                )}
                <main className="p-4 md:p-6">
                    <p id={MESSAGE_ID} className="text-paper leading-relaxed">
                        {options.message}
                    </p>
                </main>
                <footer className="flex justify-end items-center gap-3 p-4 md:p-5 border-t border-felt-700">
                    <button
                        onClick={() => onSettle(false)}
                        className="text-sage bg-transparent hover:bg-felt-700 hover:text-paper rounded-lg text-sm px-5 py-2.5 font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-felt-600/40"
                    >
                        {options.cancelLabel ?? t('close')}
                    </button>
                    <button
                        onClick={() => onSettle(true)}
                        className="text-felt-900 bg-brass hover:bg-brass-bright focus:ring-4 focus:outline-none focus:ring-brass/30 font-bold rounded-lg text-sm px-5 py-2.5 text-center transition-colors"
                    >
                        {options.confirmLabel ?? t('continue')}
                    </button>
                </footer>
            </div>
        </div>
    );
};

interface ConfirmDialogContextValue {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmDialogContext = React.createContext<ConfirmDialogContextValue | undefined>(undefined);

export const useConfirmDialog = (): ConfirmDialogContextValue['confirm'] => {
    const context = useContext(ConfirmDialogContext);
    if (!context) {
        throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider');
    }
    return context.confirm;
};

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [options, setOptions] = useState<ConfirmOptions | null>(null);
    const [visible, setVisible] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const resolverRef = useRef<((result: boolean) => void) | null>(null);
    const hideTimerRef = useRef<number | null>(null);

    const confirm = useCallback((nextOptions: ConfirmOptions) => {
        return new Promise<boolean>((resolve) => {
            resolverRef.current?.(false);
            resolverRef.current = resolve;
            if (hideTimerRef.current !== null) {
                window.clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
            setOptions(nextOptions);
            window.requestAnimationFrame(() => setVisible(true));
        });
    }, []);

    const settle = useCallback((result: boolean) => {
        const resolver = resolverRef.current;
        resolverRef.current = null;
        resolver?.(result);
        setVisible(false);
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
        }
        hideTimerRef.current = window.setTimeout(() => setOptions(null), EXIT_ANIMATION_MS);
    }, []);

    useEffect(() => {
        if (!visible) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const first = getFocusable()[0];
        if (first) {
            first.focus();
        }
        return () => {
            previouslyFocused?.focus();
        };
    }, [visible]);

    useEffect(() => {
        if (!visible) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                settle(false);
                return;
            }
            if (e.key !== 'Tab') return;
            const focusable = getFocusable();
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || !panelRef.current?.contains(active))) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [visible, settle]);

    useEffect(() => {
        return () => {
            if (hideTimerRef.current !== null) {
                window.clearTimeout(hideTimerRef.current);
            }
            resolverRef.current?.(false);
        };
    }, []);

    return (
        <ConfirmDialogContext.Provider value={{ confirm }}>
            {children}
            {options && <ConfirmDialog options={options} visible={visible} panelRef={panelRef} onSettle={settle} />}
        </ConfirmDialogContext.Provider>
    );
};
