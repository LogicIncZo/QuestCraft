import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogProvider, useConfirmDialog } from '../components/ConfirmDialog';
import { LanguageProvider } from '../services/i18n';

const Host: React.FC<{
    message?: string;
    onResult: (result: boolean) => void;
}> = ({ message = 'Delete all progress?', onResult }) => {
    const confirm = useConfirmDialog();
    return (
        <button
            onClick={() => {
                void confirm({ message }).then(onResult);
            }}
        >
            trigger
        </button>
    );
};

const renderHost = (onResult: (result: boolean) => void, message?: string) =>
    render(
        <LanguageProvider>
            <ConfirmDialogProvider>
                <Host message={message} onResult={onResult} />
            </ConfirmDialogProvider>
        </LanguageProvider>
    );

describe('ConfirmDialog (issue #79 item 3)', () => {
    it('renders the message and resolves true when the confirm button is clicked', async () => {
        const onResult = vi.fn();
        renderHost(onResult);

        await userEvent.click(screen.getByRole('button', { name: 'trigger' }));
        expect(await screen.findByText('Delete all progress?')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'continue' }));
        await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    });

    it('resolves false when the cancel button is clicked', async () => {
        const onResult = vi.fn();
        renderHost(onResult);

        await userEvent.click(screen.getByRole('button', { name: 'trigger' }));
        await screen.findByText('Delete all progress?');

        await userEvent.click(screen.getByRole('button', { name: 'close' }));
        await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    });


    it('honors custom confirmLabel and cancelLabel', async () => {
        const onResult = vi.fn();
        const CustomHost: React.FC = () => {
            const confirm = useConfirmDialog();
            return (
                <button
                    onClick={() => {
                        void confirm({
                            message: 'End the game?',
                            confirmLabel: 'End Game',
                            cancelLabel: 'Keep Playing',
                        }).then(onResult);
                    }}
                >
                    trigger
                </button>
            );
        };
        render(
            <LanguageProvider>
                <ConfirmDialogProvider>
                    <CustomHost />
                </ConfirmDialogProvider>
            </LanguageProvider>
        );

        await userEvent.click(screen.getByRole('button', { name: 'trigger' }));
        expect(await screen.findByText('End the game?')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'End Game' }));
        await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    });
});

// Issue #95: Escape pressed while the dialog is open must settle the dialog
// itself but must NOT leak through to Escape handlers registered underneath
// (drawers, the app shell), which would close them as collateral damage.
describe('ConfirmDialog escape layering (issue #95)', () => {
    it('stops Escape propagation so underlying Escape handlers do not fire', async () => {
        const onResult = vi.fn();
        let drawerClosedByEscape = false;

        // Simulate a drawer-level Escape handler (bubble phase, like the
        // drawers in App.tsx).
        const drawerHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') drawerClosedByEscape = true;
        };
        document.addEventListener('keydown', drawerHandler);

        try {
            renderHost(onResult);
            await userEvent.click(screen.getByRole('button', { name: 'trigger' }));
            await screen.findByText('Delete all progress?');
            // The keydown listener is registered in an effect that runs after
            // visible=true (rAF). The dialog focusing its first button is the
            // observable signal that the effect chain has completed — dispatch
            // before it and Escape is silently dropped.
            await waitFor(() =>
                expect(screen.getByRole('button', { name: 'close' })).toHaveFocus()
            );

            // Dispatch at the dialog itself, not document: real Escape targets
            // the focused element inside the dialog, making document an
            // ancestor whose capture listener fires before any bubble handler.
            screen
                .getByRole('alertdialog')
                .dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
                );

            await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
            expect(drawerClosedByEscape).toBe(false);
        } finally {
            document.removeEventListener('keydown', drawerHandler);
        }
    });
});
