import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HamburgerMenu from '../components/HamburgerMenu';
import { LanguageProvider } from '../services/i18n';

const renderMenu = (isOpen: boolean, onNavigate: (page: string) => void = () => {}) => {
    render(
        <LanguageProvider>
            <HamburgerMenu
                isOpen={isOpen}
                onClose={() => {}}
                onNavigate={onNavigate}
                currentPage="home"
                isMakerModeEnabled
            />
        </LanguageProvider>
    );
};

describe('HamburgerMenu a11y (issue #79 item 2)', () => {
    it('removes the closed drawer from the accessibility tree: aria-hidden=true and inert', () => {
        renderMenu(false);

        const nav = screen.getByRole('navigation', { hidden: true });
        expect(nav).toHaveAttribute('aria-hidden', 'true');
        expect(nav).toHaveAttribute('inert');
    });

    it('keeps the open drawer in the accessibility tree and its navigation clickable', async () => {
        const onNavigate = vi.fn();
        renderMenu(true, onNavigate);

        const nav = screen.getByRole('navigation');
        expect(nav).not.toHaveAttribute('inert');
        expect(nav).not.toHaveAttribute('aria-hidden');

        await userEvent.click(screen.getByRole('button', { name: 'menuHome' }));
        expect(onNavigate).toHaveBeenCalledWith('home');
    });
});
