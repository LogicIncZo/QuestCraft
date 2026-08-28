import { describe, it, expect } from 'vitest';
import showdown from 'showdown';
import { sanitizeHtml } from '../utils/sanitizeHtml';

const converter = new showdown.Converter({
    ghCompatibleHeaderId: true,
    simpleLineBreaks: true,
    tables: true,
});

describe('sanitizeHtml', () => {
    it('removes script tags entirely', () => {
        const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
        expect(out).not.toContain('<script');
        expect(out).toContain('hi');
    });

    it('strips onerror/onload inline event handlers', () => {
        const out = sanitizeHtml('<img src="x" onerror="alert(1)"><div onload="alert(2)">t</div>');
        expect(out).not.toContain('onerror');
        expect(out).not.toContain('onload');
        expect(out).toContain('<img');
    });

    it('removes javascript: URIs from links and images', () => {
        const out = sanitizeHtml(
            '<a href="javascript:alert(1)">click</a><img src="javascript:alert(2)">'
        );
        expect(out).not.toContain('javascript:');
    });

    it('removes javascript: URIs from markdown link syntax (via showdown, as in the app pipeline)', () => {
        const md = '[click me](javascript:alert(document.cookie))';
        const html = converter.makeHtml(md);
        const out = sanitizeHtml(html);
        expect(out.toLowerCase()).not.toContain('javascript:');
    });

    it('removes data:text/html URIs from links', () => {
        const out = sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');
        expect(out.toLowerCase()).not.toContain('data:text/html');
        expect(out.toLowerCase()).not.toMatch(/<a[^>]+href="data:/);
    });

    it('strips iframe, object, embed, and form elements', () => {
        const out = sanitizeHtml(
            '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><form action="x"><input></form>'
        );
        expect(out).not.toMatch(/<(iframe|object|embed|form|input)\b/i);
    });

    it('strips svg script vectors', () => {
        const out = sanitizeHtml('<svg><script>alert(1)</script><circle onload="alert(2)"/></svg>');
        expect(out).not.toContain('<script');
        expect(out).not.toContain('onload');
    });

    it('removes style attributes and style tags (CSS injection)', () => {
        const out = sanitizeHtml(
            '<div style="background:url(javascript:alert(1))">t</div><style>body{}</style>'
        );
        expect(out).not.toContain('style=');
        expect(out).not.toContain('<style');
    });

    it('preserves safe markdown-rendered HTML', () => {
        const safe =
            '<h2 id="title">Title</h2><p>Some <strong>bold</strong> and <a href="https://example.com" rel="noopener">link</a>.</p><ul><li>item</li></ul><pre><code>code</code></pre><table><thead><tr><th>h</th></tr></thead></table>';
        const out = sanitizeHtml(safe);
        expect(out).toContain('<strong>bold</strong>');
        expect(out).toContain('href="https://example.com"');
        expect(out).toContain('<li>item</li>');
        expect(out).toContain('<code>code</code>');
        expect(out).toContain('<table>');
    });

    it('is idempotent on already-sanitized output', () => {
        const once = sanitizeHtml('<p>ok</p><script>x</script>');
        const twice = sanitizeHtml(once);
        expect(twice).toBe(once);
    });
});
