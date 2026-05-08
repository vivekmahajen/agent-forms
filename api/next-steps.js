const { createKV, getSessionToken } = require('./_utils');
const kv = createKV();

const LANG_FULL = {
  es: 'Spanish', pt: 'Portuguese', fr: 'French', zh: 'Mandarin Chinese',
  vi: 'Vietnamese', tl: 'Tagalog', ko: 'Korean', ar: 'Arabic',
};

const SYSTEM_PROMPT = `You are FormIQ's post-completion advisor. Given a form name and optional user state, return a JSON array of actionable next-steps a filer must take AFTER completing the form.

Return ONLY a valid JSON array — no markdown, no backticks, no preamble.

Each element has this exact shape:
{
  "step": <integer starting at 1>,
  "category": <one of: "filing_method" | "fee" | "processing_time" | "documents" | "deadline" | "after_submission" | "tip">,
  "title": "<short imperative title, max 10 words>",
  "detail": "<1–2 sentences: specific, actionable. Include exact dollar amounts, phone numbers, fax numbers, PO Box addresses, portal URLs, processing times. For mailing: give the correct IRS/agency address. For state-specific info use the user's state if provided.>",
  "links": [
    { "label": "<short label>", "url": "<exact https:// government URL — only include if you are confident it is correct and stable>" }
  ]
}

Coverage requirements — include AT LEAST one step for each of these categories (where applicable to the form):
1. filing_method — every submission option: online portal, fax, mail (with exact address)
2. fee — exact filing fee; state clearly if free ($0)
3. processing_time — separate times for each submission method
4. documents — list every supporting document or attachment required
5. deadline — any hard deadline, election window, or time-sensitive rule
6. after_submission — what the filer receives, when, and what to do with it
7. tip — one common mistake or pro tip that saves time or prevents rejection

Rules:
- Be specific: "Mail to Internal Revenue Service, Attn: EIN Operation, Cincinnati, OH 45999" not "mail to the IRS"
- Never invent URLs — only include links you are certain are real and stable government URLs
- If a step is not applicable to this form, omit that category rather than writing "N/A"
- Order steps chronologically: filing first, then documents, fee, deadline, processing, after_submission, tips last`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });

  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'session_expired' });

  const { formName, state, lang } = req.body || {};
  if (!formName || typeof formName !== 'string') {
    return res.status(400).json({ error: 'formName is required' });
  }

  // Cache per form+state+lang for 24 hours — next-steps don't change often
  const cacheKey = `nextsteps:${formName.toLowerCase().trim()}:${(state || '').toLowerCase()}:${lang || 'en'}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return res.status(200).json({ steps: cached });
  } catch {}

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Form: ${formName}${state ? `\nUser's state: ${state}` : ''}${lang && lang !== 'en' && LANG_FULL[lang] ? `\n\nIMPORTANT: Return all step titles and detail text in ${LANG_FULL[lang]}. Keep URLs, form names, agency names, and dollar amounts in their original form.` : ''}\n\nGenerate the post-completion next-steps checklist.`,
        }],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json({ error: err?.error?.message || 'AI error' });
    }

    const data = await upstream.json();
    const text = ((data.content || []).find(b => b.type === 'text') || {}).text || '[]';
    const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const steps = JSON.parse(clean);

    await kv.set(cacheKey, steps, { ex: 24 * 60 * 60 }).catch(() => {});
    return res.status(200).json({ steps });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
