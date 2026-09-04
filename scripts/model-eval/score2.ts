const TAMIL = /[\u0B80-\u0BFF]/;
const HI = /[\u0900-\u097F]/;
const ES = /[áéíóúñ¿¡]/i;
export const extract = (raw: string): { data: any; tier: string } => {
  try { return { data: JSON.parse(raw), tier: 'direct' }; } catch {}
  const m = raw.match(/```json\n?([\s\S]*?)\n?```/);
  if (m) { try { return { data: JSON.parse(m[1]), tier: 'markdown' }; } catch {} }
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return { data: JSON.parse(raw.slice(s, e + 1)), tier: 'bracket' }; } catch {} }
  return { data: null, tier: 'fail' };
};
const isLoc = (v: any): boolean => !!v && typeof v === 'object' && !Array.isArray(v) && ['en', 'es', 'hi', 'ta'].every((k) => typeof v[k] === 'string' && v[k].length > 0);
const scriptOK = (v: any): boolean => isLoc(v) && TAMIL.test(v.ta) && HI.test(v.hi) && ES.test(v.es);
const asArr = (v: any): any[] => (Array.isArray(v) ? v : []);
export interface Scored { tier: string; valid: boolean; fails: string[]; choiceIdx?: number; keyCompliant?: boolean; raw: string; finish: string | null; usage: any; latencyMs: number; fallbackNoJsonMode: boolean; error?: string }
export const scoreQuest = (r: any, exp: { numLocations: number; positivity: number; grounding: boolean }): Scored => {
  const { data, tier } = extract(r.raw);
  const f: string[] = [];
  if (!data) return { tier, valid: false, fails: ['unparseable'], raw: r.raw, finish: r.finish, usage: r.usage, latencyMs: r.latencyMs, fallbackNoJsonMode: r.fallbackNoJsonMode, error: r.error };
  const board = data.board ?? {};
  const locs = asArr(board.locations);
  const types = locs.map((l: any) => String(l?.type ?? '').toUpperCase());
  if (locs.length !== exp.numLocations) f.push(`locations=${locs.length}!=${exp.numLocations}`);
  if (types[0] !== 'START') f.push('no-START-at-0');
  const jailIdx = types.indexOf('JAIL');
  if (jailIdx === -1) f.push('no-JAIL');
  if (board.jailPosition !== jailIdx) f.push(`jailPosition=${JSON.stringify(board.jailPosition)}!=${jailIdx}`);
  if (!types.includes('FREE_PARKING')) f.push('no-FREE_PARKING');
  if (!types.includes('GO_TO_JAIL')) f.push('no-GO_TO_JAIL');
  const res = asArr(data.resources);
  if (res.length !== 3) f.push(`resources=${res.length}!=3`);
  const resNames = res.map((x: any) => String(x?.name?.en ?? x?.name ?? '').toLowerCase());
  if (!res.every((x: any) => typeof x?.initialValue === 'number' && typeof x?.minimumValue === 'number' && typeof x?.maximumValue === 'number')) f.push('resource-numeric-fields');
  if (!scriptOK(data.name) || !scriptOK(data.description)) f.push('name/desc-localization');
  if (locs.length > 0 && !locs.every((l: any) => scriptOK(l?.name) && scriptOK(l?.description))) f.push('location-localization');
  const cards = asArr(data.chanceCards);
  if (cards.length === 0) f.push('no-chanceCards');
  else if (!cards.every((c: any) => scriptOK(c?.description) && asArr(c?.resourceChanges).every((rc: any) => typeof rc?.value === 'number' && resNames.includes(String(rc?.name).toLowerCase())))) f.push('chanceCard-invalid');
  const foot = asArr(data.footerSections);
  const titles = foot.map((s: any) => String(s?.title?.en ?? s?.title ?? '').toLowerCase());
  if (!titles.includes('rules') || !titles.includes('about')) f.push('footer-Rules/About');
  if (Math.abs(Number(data.positivity) - exp.positivity) > 0.011) f.push(`positivity=${data.positivity}!=${exp.positivity}`);
  if (Boolean(data.groundingInReality) !== exp.grounding) f.push(`grounding=${data.groundingInReality}!=${exp.grounding}`);
  return { tier, valid: f.length === 0, fails: f, raw: r.raw, finish: r.finish, usage: r.usage, latencyMs: r.latencyMs, fallbackNoJsonMode: r.fallbackNoJsonMode, error: r.error };
};
export const scoreScenario = (r: any): Scored => {
  const { data, tier } = extract(r.raw);
  const f: string[] = [];
  if (!data) return { tier, valid: false, fails: ['unparseable'], raw: r.raw, finish: r.finish, usage: r.usage, latencyMs: r.latencyMs, fallbackNoJsonMode: r.fallbackNoJsonMode, error: r.error };
  const sc = Array.isArray(data) ? data[0] : (data.scenarios?.[0] ?? data.scenario ?? data);
  if (!scriptOK(sc?.title) || !scriptOK(sc?.description)) f.push('title/desc-localization');
  const ch = asArr(sc?.choices);
  if (ch.length !== 2) f.push(`choices=${ch.length}!=2`);
  if (!ch.every((c: any) => scriptOK(c?.text) && scriptOK(c?.outcome?.explanation))) f.push('choice-localization');
  if (!ch.every((c: any) => asArr(c?.outcome?.resourceChanges).every((rc: any) => typeof rc?.name === 'string' && typeof rc?.value === 'number'))) f.push('resourceChanges-invalid');
  return { tier, valid: f.length === 0, fails: f, raw: r.raw, finish: r.finish, usage: r.usage, latencyMs: r.latencyMs, fallbackNoJsonMode: r.fallbackNoJsonMode, error: r.error };
};
export const scoreChoice = (r: any, correct: number): Scored => {
  const { data, tier } = extract(r.raw);
  const s: Scored = { tier, valid: false, fails: [], raw: r.raw, finish: r.finish, usage: r.usage, latencyMs: r.latencyMs, fallbackNoJsonMode: r.fallbackNoJsonMode, error: r.error };
  if (!data) { s.fails = ['unparseable']; return s; }
  const cand = data.choiceIndex ?? data.choice ?? data.option ?? data.selected ?? data.chosenIndex ?? data.selectedIndex;
  s.choiceIdx = typeof cand === 'string' && /^\d$/.test(cand) ? Number(cand) : (typeof cand === 'number' ? cand : undefined);
  s.keyCompliant = typeof data.choiceIndex === 'number';
  s.valid = s.choiceIdx !== undefined && typeof data.reasoning === 'string' && data.reasoning.length > 0;
  if (!s.valid) s.fails = [s.choiceIdx === undefined ? 'no-index-key' : 'no-reasoning'];
  return s;
};
export const scoreChat = (r: any): Scored => {
  const raw = r.raw ?? '';
  const words = raw.trim().split(/\s+/).filter(Boolean).length;
  const refused = /as an ai language model|i cannot help/i.test(raw);
  const jsonLeak = /\{\s*"en"\s*:/.test(raw);
  const valid = words > 0 && words <= 160 && !refused && !jsonLeak;
  const fails: string[] = [];
  if (words === 0) fails.push('empty'); else if (words > 160) fails.push(`too-long-${words}`);
  if (refused) fails.push('refused');
  if (jsonLeak) fails.push('json-leak');
  return { tier: 'text', valid, fails, raw, finish: r.finish, usage: r.usage, latencyMs: r.latencyMs, fallbackNoJsonMode: r.fallbackNoJsonMode, error: r.error };
};
