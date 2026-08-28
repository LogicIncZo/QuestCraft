import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { LanguageProvider } from '../services/i18n';

describe('App smoke', () => {
    it('renders the welcome screen', () => {
        render(
            <LanguageProvider>
                <App />
            </LanguageProvider>
        );
        expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
    });
});
