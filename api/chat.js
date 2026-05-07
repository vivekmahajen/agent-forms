const { createKV, getSessionToken } = require('./_utils');
const kv = createKV();

const SYSTEM_PROMPT = `You are FormIQ Assistant — a friendly, expert support agent for FormIQ, a service that helps people understand and complete official forms.

You have deep expertise in:
• US Tax forms: W-2, W-4, W-9, 1040 (and Schedules A–E), SS-4, 4506-T, 1099 series, 8962, and more
• USCIS immigration forms: I-9, I-130, I-485, I-765, I-864, N-400, and more
• Social Security: SS-5, SSA-827, SSA-44
• State Department: DS-11, DS-82 (passports)
• VA, DOL/FMLA, CMS/Medicare forms
• FormIQ features: instant form lookup, field-by-field instructions, filled PDF preview/download, related forms

About FormIQ:
• Free Trial: 10 lookups/day for 7 days, no credit card needed
• Pro: $29/month — unlimited lookups, PDF export, form history
• Team: $99/month — up to 10 seats, shared history, API access
• The search bar accepts any form name (e.g. "W-9", "I-9", "Form 1040")

Tone & style:
• Be warm, concise, and jargon-free — users may be stressed about paperwork
• Give direct answers with specific details (dates, dollar thresholds, form numbers)
• When someone asks about a specific form, encourage them to use FormIQ's search for full field-by-field guidance and a prefilled sample
• For billing/account issues say: "Please reach out to our support team at support@formiq.app"
• Never make up URLs — only cite official gov domains (irs.gov, uscis.gov, ssa.gov, etc.)
• If uncertain, say so clearly rather than guessing`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, guestId } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Rate-limit unauthenticated guests: 30 messages/day per guestId
  const token = getSessionToken(req);
  let authed = false;
  if (token) {
    const email = await kv.get(`session:${token}`);
    if (email) authed = true;
  }

  if (!authed && guestId && typeof guestId === 'string' && guestId.length <= 64) {
    const rateKey = `chat_guest:${guestId}:${new Date().toISOString().split('T')[0]}`;
    const count = (await kv.get(rateKey)) || 0;
    if (count >= 30) {
      return res.status(429).json({
        error: 'limit_reached',
        reply: "You've reached today's chat limit. Sign up for a free FormIQ account to keep going — it only takes 30 seconds!",
      });
    }
    await kv.set(rateKey, count + 1, { ex: 25 * 60 * 60 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

  const sanitized = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20); // keep last 20 turns for context

  if (!sanitized.length) return res.status(400).json({ error: 'No valid messages' });

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
        max_tokens: 1024,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: sanitized,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json({ error: err?.error?.message || 'AI error' });
    }

    // Stream text chunks directly to the client
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const evt = JSON.parse(data);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            res.write(evt.delta.text);
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
};
