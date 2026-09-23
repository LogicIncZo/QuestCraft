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
