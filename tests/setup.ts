import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
        if (String(url).startsWith('/locales/')) {
            return {
                ok: true,
                json: async () => ({}),
            } as Response;
        }
        throw new Error(`Unhandled fetch in test: ${url}`);
    })
);
