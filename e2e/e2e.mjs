#!/usr/bin/env node
/**
 * End-to-end smoke suite for QuestCraft key flows, driven by agent-browser.
 *
 * Covers the flows from the 2026-09-04 e2e audit (issues #77/#78):
 *   1. Home page loads
 *   2. Default quest list is populated (regression: quests/ missing from prod build, #77)
 *   3. Static assets serve with correct content types (regression: SPA fallback, #77)
 *   4. Docs article renders non-blank content (regression: blank docs, #77)
 *   5. Quest load -> setup -> game board renders with a Roll button
 *   6. Settings page + language switch en -> ta -> en
 *   7. No console errors during the whole run
 *
 * Usage:
 *   npm run build && npx vite preview --port 4173   # in a separate shell
 *   node e2e/e2e.mjs [--base-url http://localhost:4173]
 *
 * Requires the `agent-browser` CLI on PATH.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const baseUrlArgIdx = args.indexOf('--base-url');
const BASE_URL = baseUrlArgIdx >= 0 ? args[baseUrlArgIdx + 1] : process.env.BASE_URL || 'http://localhost:4173';

const CMD_TIMEOUT_MS = 45_000;
let passed = 0;
let failed = 0;
const failures = [];

const ok = (name) => {
    passed++;
    console.log(`  \x1b[32m✓\x1b[39m ${name}`);
};

const fail = (name, detail) => {
    failed++;
    failures.push({ name, detail });
    console.log(`  \x1b[31m✗ ${name}\n    ${detail}\x1b[39m`);
};

const ab = (args_, timeoutMs = CMD_TIMEOUT_MS) =>
    execFileSync('agent-browser', args_, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });

const snapshot = () => ab(['snapshot']);
const consoleLog = () => ab(['console']);

/** Click the first element whose accessible name contains `name` in the latest snapshot. */
const clickNamed = (name) => {
    const snap = snapshot();
    const line = snap
        .split('\n')
        .find((l) => l.includes(`"${name}"`) && /ref=e\d+/.test(l));
    if (!line) throw new Error(`no element named "${name}" found in snapshot`);
    ab(['click', line.match(/ref=(e\d+)/)[1]]);
};

const assert = (name, condition, detail = '') => {
    if (condition) ok(name);
    else fail(name, detail);
};

/** Open the hamburger menu deterministically: close any stale overlay first,
 * then click and let the open animation settle before the next snapshot. */
const openMenu = () => {
    try { ab(['press', 'Escape']); ab(['wait', 300]); } catch { /* no overlay */ }
    clickNamed('Open navigation menu');
    ab(['wait', 600]);
};

const goto = (path) => {
    ab(['open', `${BASE_URL}${path}`]);
    ab(['wait', 2500]);
};

// ---------------------------------------------------------------------------
console.log(`QuestCraft e2e → ${BASE_URL}\n`);

try {
    execFileSync('agent-browser', ['--version'], { encoding: 'utf8', timeout: 10_000 });
} catch {
    console.error('agent-browser CLI not found on PATH. Install: https://github.com/vercel-labs/agent-browser');
    process.exit(2);
}

// -- 1. Home page -----------------------------------------------------------
console.log('[1] Home page');
// Start from a clean slate: persisted page state from a previous session
// could land us straight into an in-progress game.
goto('/');
ab(['eval', 'localStorage.clear()']);
// Force a real reload: `open` to the same URL is a no-op, and the SPA
// restores its page from in-memory state otherwise.
ab(['eval', 'location.reload()']);
ab(['wait', 3000]);
const homeSnap = snapshot();
assert(
    'app title and mode chooser render',
    /QuestCraft - AI Powered Board Game Engine/.test(ab(['get', 'title'])) &&
        /Choose Your Mode/.test(homeSnap),
    'missing title or "Choose Your Mode"'
);

// -- 2. Default quest list (issue #77) --------------------------------------
console.log('[2] Default quest list');
await clickNamed('Player Mode');
ab(['wait', 1500]);
const questSnap = snapshot();
assert(
    'default quests are listed (9 shipped quests)',
    /Aadhaar Quest/.test(questSnap) && /Metro Master/.test(questSnap) && /City of Mayors/.test(questSnap),
    'expected at least Aadhaar/Metro/Chennai quest cards; quest list likely empty (#77 regression)'
);

// -- 3. Static asset content types (issue #77) ------------------------------
console.log('[3] Static asset content types');
const ctQuest = ab([
    'eval',
    `fetch('/quests/aadhaar-quest.json').then(r => r.headers.get('content-type') || 'none')`,
]);
const ctDoc = ab([
    'eval',
    `fetch('/docs/introduction.md').then(r => r.headers.get('content-type') || 'none')`,
]);
assert('quests/*.json served as JSON', /json/i.test(ctQuest), `got content-type: ${ctQuest}`);
assert('docs/*.md served as markdown/text', /markdown|text/i.test(ctDoc), `got content-type: ${ctDoc}`);

// -- 4. Quest load -> setup -> board (also covers #77 quest fetch) -----------
console.log('[4] Load quest and start a game');
// Use the same-origin quest JSON so the suite runs fully offline.
const snap0 = snapshot();
const urlInputRef = snap0.match(/textbox "Paste Gist[^"]*"[^\n]*\[[^\]]*ref=(e\d+)\]/)?.[1];
if (!urlInputRef) fail('URL textbox found', 'no "Paste Gist" textbox in snapshot');
else {
    ab(['fill', urlInputRef, `${BASE_URL}/quests/aadhaar-quest.json`]);
    const loadBtn = snapshot().match(/button "Load"[^\n]*\[[^\]]*ref=(e\d+)\]/)?.[1];
    if (!loadBtn) fail('Load button found', 'no Load button in snapshot');
    else {
        ab(['click', loadBtn]);
        ab(['wait', 2500]);
    }
}
const setupSnap = snapshot();
assert('quest setup screen appears after loading', /Aadhaar Quest|Main Menu|Start/i.test(setupSnap), 'setup screen not detected');
const startRef =
    setupSnap.match(/button "(?:Start Game|Start|Play)[^"]*"[^\n]*\[[^\]]*ref=(e\d+)\]/i)?.[1];
if (startRef) {
    // Scroll the CTA into view first: on default viewports the button can sit
    // under the fixed status bar until scrolled, which makes raw clicks land
    // on the covering container.
    ab(['scrollintoview', startRef]);
    ab(['wait', 400]);
    ab(['click', startRef]);
    ab(['wait', 3500]);
}
const boardSnap = snapshot();
assert(
    'game board renders with roll control',
    /START/.test(boardSnap) && /Roll Dice/.test(boardSnap),
    'board or Roll Dice button missing'
);

// -- 5. Docs render non-blank (issue #77) ------------------------------------
console.log('[5] Documentation');
openMenu();
await clickNamed('Documentation');
ab(['wait', 2500]);
const docsTextLen = Number(
    ab(['eval', `document.querySelector('main')?.innerText?.length ?? 0`])
);
assert('docs article renders non-blank content', docsTextLen > 300, `main innerText length = ${docsTextLen}`);

// -- 6. Settings + i18n ------------------------------------------------------
console.log('[6] Settings and language switch');
// Navigate via persisted page state + reload instead of the hamburger menu:
// the menu's open/close animation makes clicks flaky, and the off-screen
// sidebar items swallow clicks from automation.
ab([
    'eval',
    "localStorage.removeItem('questcraft-active-quest'); localStorage.removeItem('questcraft-game-state'); localStorage.setItem('questcraft-current-page', 'settings'); localStorage.setItem('questcraft-app-settings', JSON.stringify({ language: 'en' })); 'ok'",
]);
ab(['eval', 'location.reload()']);
ab(['wait', 3000]);
const settingsSnap = snapshot();
assert('settings page renders', /Settings & Management|Language/.test(settingsSnap), 'settings heading missing');

const comboRe = /combobox \[expanded[^\n]*ref=(e\d+)\]/;
let langCombo = settingsSnap.match(comboRe)?.[1];
if (!langCombo) {
    // Collapsed: expand the Language accordion, then re-snapshot.
    const langSectionRef = settingsSnap.match(/button "Language"[^\n]*\[[^\]]*ref=(e\d+)\]/)?.[1];
    if (langSectionRef) {
        ab(['click', langSectionRef]);
        // The accordion expands with an animation; wait long enough for the
        // select to mount before reading the snapshot, then retry once.
        ab(['wait', 2500]);
        langCombo = snapshot().match(comboRe)?.[1];
        if (!langCombo) {
            ab(['wait', 2500]);
            langCombo = snapshot().match(comboRe)?.[1];
        }
    }
}

const selectLang = (ref, value, label) => {
    // agent-browser's select matches by label; try the raw value first, then
    // fall back to the visible label.
    try {
        ab(['select', ref, value]);
    } catch {
        ab(['select', ref, label]);
    }
};

if (langCombo) {
    selectLang(langCombo, 'ta', 'தமிழ்');
    ab(['wait', 1500]);
    const taSnap = snapshot();
    assert('UI switches to Tamil', /அமைப்புகள்|மொழி/.test(taSnap), 'Tamil strings not found after switch');
    selectLang(langCombo, 'en', 'English');
    ab(['wait', 1000]);
} else {
    fail('UI switches to Tamil', 'language combobox not found after expanding Language section');
}

// -- 7. Console error scan ----------------------------------------------------
console.log('[7] Console error scan');
const consoleOut = consoleLog();
const errorLines = consoleOut
    .split('\n')
    .filter((l) => /\[error\]/i.test(l))
    .filter((l) => !/Loading may be slow/i.test(l));
assert(
    'no console errors during the run',
    errorLines.length === 0,
    `${errorLines.length} console error(s):\n      ${errorLines.slice(0, 5).join('\n      ')}`
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
}
