import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import DocContent from '../components/DocContent';
import ChatDrawer from '../components/ChatDrawer';
import type { QuestConfig } from '../types';

const XSS_MARKDOWN = [
    '# Safe Heading',
    '',
    '<script>window.__pwned = true;</script>',
    '<img src="x" onerror="window.__pwned = true">',
    '<a href="javascript:window.__pwned = true">bad link</a>',
    '<iframe src="https://evil.example"></iframe>',
    'Normal **markdown** text.',
].join('\n');

describe('DocContent XSS (issue #57)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        (window as any).__pwned = false;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (String(url).startsWith('/locales/')) {
                return { ok: true, json: async () => ({}) } as Response;
            }
            if (String(url).includes('/docs/')) {
                return { ok: true, text: async () => XSS_MARKDOWN } as Response;
            }
            throw new Error(`Unhandled fetch in test: ${url}`);
        }));
    });

    it('renders docs markdown without executing injected scripts', async () => {
        render(<DocContent docId="evil" onHeadingsExtracted={() => {}} />);

        await waitFor(() => {
            expect(screen.getByText(/Normal/)).toBeInTheDocument();
        });

        expect(document.querySelector('script')).toBeNull();
        expect(document.querySelector('iframe')).toBeNull();
        expect(document.querySelector('img[onerror]')).toBeNull();
        expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
        expect((window as any).__pwned).toBe(false);
    });
});

vi.mock('../services/i18n', () => ({
    useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../services/aiService', () => ({
    chatManager: {
        initialize: vi.fn(),
        sendMessageStream: vi.fn(async function* () {
            yield '<script>alert("from-model")</script><img src=x onerror="window.__pwned = true">';
        }),
    },
    loadPrompt: vi.fn(async () => 'system instruction'),
}));

vi.mock('../services/settingsService', () => ({
    settingsService: {
        getAiSettings: vi.fn(() => ({ providerId: 'gemini' })),
    },
}));

const baseQuest = {
    id: 'q1',
    name: { en: 'Test Quest' },
    description: { en: 'A quest' },
    board: { size: 8 },
} as unknown as QuestConfig;

describe('ChatDrawer XSS (issue #57)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        (window as any).__pwned = false;
        Element.prototype.scrollIntoView = vi.fn();
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (String(url).startsWith('/locales/')) {
                return { ok: true, json: async () => ({}) } as Response;
            }
            return { ok: true, text: async () => '' } as Response;
        }));
    });

    it('renders malicious model output inert (no script execution)', async () => {
        const user = userEvent.setup();
        render(
            <ChatDrawer
                show={true}
                onClose={() => {}}
                page="game"
                questConfig={baseQuest}
                draftQuest={null}
                onApplyQuestUpdate={() => {}}
            />
        );

        const input = await screen.findByRole('textbox');
        await user.type(input, 'hello');
        await user.keyboard('{Enter}');

        await waitFor(() => {
            expect(document.querySelector('img[src="x"]')).toBeInTheDocument();
        }, { timeout: 5000 });

        expect(document.querySelector('script')).toBeNull();
        expect(document.querySelector('img[onerror]')).toBeNull();
        expect(screen.queryByText(/from-model/i)).toBeNull();
        expect((window as any).__pwned).toBe(false);
    });
});
