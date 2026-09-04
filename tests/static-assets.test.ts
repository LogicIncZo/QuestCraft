import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { DEFAULT_QUEST_PATHS, DOC_LINKS } from '../constants';
import { fetchJsonAsset, fetchTextAsset, StaticAssetError } from '../utils/staticAssets';

const PUBLIC_DIR = path.resolve(__dirname, '../public');

describe('static assets ship in public/', () => {
    it('every default quest path exists under public/ and parses as quest JSON', () => {
        expect(DEFAULT_QUEST_PATHS.length).toBeGreaterThan(0);

        for (const questPath of DEFAULT_QUEST_PATHS) {
            const filePath = path.join(PUBLIC_DIR, questPath);
            expect(existsSync(filePath), `missing bundled quest file: ${questPath}`).toBe(true);

            const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
            expect(parsed.name?.en, `quest missing name.en: ${questPath}`).toBeTruthy();
            expect(
                Array.isArray(parsed.resources) && parsed.resources.length > 0,
                `quest missing resources: ${questPath}`
            ).toBe(true);
            expect(
                Array.isArray(parsed.board?.locations) && parsed.board.locations.length > 0,
                `quest missing board locations: ${questPath}`
            ).toBe(true);
        }
    });

    it('does not register quest paths that no longer exist on disk', () => {
        const questsDir = path.join(PUBLIC_DIR, 'quests');
        const onDisk = new Set(
            readdirSync(questsDir)
                .filter((f) => f.endsWith('.json'))
                .map((f) => `/quests/${f}`)
        );

        for (const questPath of DEFAULT_QUEST_PATHS) {
            expect(onDisk.has(questPath), `registered path missing on disk: ${questPath}`).toBe(
                true
            );
        }
    });

    it('every doc link has a markdown file under public/docs', () => {
        for (const link of DOC_LINKS) {
            const filePath = path.join(PUBLIC_DIR, 'docs', `${link.id}.md`);
            expect(existsSync(filePath), `missing doc file: docs/${link.id}.md`).toBe(true);

            const content = readFileSync(filePath, 'utf-8');
            expect(content.trim().length, `empty doc: ${link.id}`).toBeGreaterThan(0);
            expect(content.startsWith('<!doctype'), `doc is HTML fallback: ${link.id}`).toBe(
                false
            );
        }
    });
});

describe('fetchJsonAsset', () => {
    it('rejects HTML responses (SPA fallback) with a clear error', async () => {
        global.fetch = (() =>
            Promise.resolve(
                new Response('<!doctype html><html></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' },
                })
            )) as typeof fetch;

        await expect(fetchJsonAsset('/quests/nope.json')).rejects.toThrow(/HTML document \(SPA fallback\)/i);
    });

    it('parses and returns JSON when the content type is correct', async () => {
        global.fetch = (() =>
            Promise.resolve(
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            )) as typeof fetch;

        await expect(fetchJsonAsset('/quests/fine.json')).resolves.toEqual({ ok: true });
    });

    it('still parses JSON served without an explicit content type', async () => {
        global.fetch = (() =>
            Promise.resolve(new Response('{"ok":1}', { status: 200 }))) as typeof fetch;

        await expect(fetchJsonAsset('/quests/plain.json')).resolves.toEqual({ ok: 1 });
    });

    it('throws on HTTP error responses', async () => {
        global.fetch = (() =>
            Promise.resolve(new Response('gone', { status: 404 }))) as typeof fetch;

        await expect(fetchJsonAsset('/quests/gone.json')).rejects.toThrow(/404/);
    });
});

describe('fetchTextAsset', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns text content for markdown assets', async () => {
        vi.stubGlobal(
            'fetch',
            (() =>
                Promise.resolve(
                    new Response('# Hello', { status: 200, headers: { 'Content-Type': 'text/markdown' } })
                )) as typeof fetch
        );

        await expect(fetchTextAsset('/docs/introduction.md')).resolves.toBe('# Hello');
    });

    it('rejects HTML responses (SPA fallback) with a clear error', async () => {
        vi.stubGlobal(
            'fetch',
            (() =>
                Promise.resolve(
                    new Response('<!doctype html><html></html>', {
                        status: 200,
                        headers: { 'Content-Type': 'text/html' },
                    })
                )) as typeof fetch
        );

        await expect(fetchTextAsset('/docs/gone.md')).rejects.toThrow(StaticAssetError);
    });
});
