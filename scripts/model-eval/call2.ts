const OR = 'https://openrouter.ai/api/v1/chat/completions';
export interface CallResult { raw: string; finish: string | null; usage: any; latencyMs: number; fallbackNoJsonMode: boolean; error?: string }
export const callModel = async (model: string, system: string, user: string, jsonMode: boolean, timeoutMs = 300000): Promise<CallResult> => {
  const t0 = Date.now();
  const body: any = { model, max_tokens: 16000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(OR, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { raw: '', finish: null, usage: null, latencyMs: Date.now() - t0, fallbackNoJsonMode: false, error: j.error?.message || `HTTP ${r.status}` };
    const msg = j.choices?.[0]?.message;
    let raw: string = msg?.content ?? '';
    if (Array.isArray(raw)) raw = raw.map((p: any) => p.text ?? '').join('');
    if (jsonMode && !raw && msg?.reasoning) raw = msg.reasoning;
    return { raw, finish: j.choices?.[0]?.finish_reason ?? null, usage: j.usage ?? null, latencyMs: Date.now() - t0, fallbackNoJsonMode: false };
  } catch (e: any) {
    return { raw: '', finish: null, usage: null, latencyMs: Date.now() - t0, fallbackNoJsonMode: false, error: e?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : String(e?.message || e) };
  } finally { clearTimeout(timer); }
};
