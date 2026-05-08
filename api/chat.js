const { createKV, getSessionToken } = require('./_utils');
const kv = createKV();

const LANG_FULL = {
  es: 'Spanish', pt: 'Portuguese', fr: 'French', zh: 'Mandarin Chinese',
  vi: 'Vietnamese', tl: 'Tagalog', ko: 'Korean', ar: 'Arabic',
};

const BASE_SYSTEM_PROMPT = `You are FormIQ Assistant — a friendly, expert support agent for FormIQ, a service that helps people understand and complete official forms.

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

function buildSystemPrompt(formContext) {
  if (!formContext || !formContext.formName || !Array.isArray(formContext.fields) || !formContext.fields.length) {
    return BASE_SYSTEM_PROMPT;
  }

  const fieldList = formContext.fields
    .map((f, i) => {
      let line = `${i + 1}. **${f.field}**`;
      if (f.instruction) line += `\n   How to fill: ${f.instruction}`;
      if (f.warning) line += `\n   ⚠ Common mistake: ${f.warning}`;
      return line;
    })
    .join('\n');

  // Build profile pre-fill block if the user has saved data
  let profileBlock = '';
  const p = formContext.savedProfile;
  if (p && Object.keys(p).length) {
    const lines = [];
    if (p.fullName)       lines.push(`Full name: ${p.fullName}`);
    if (p.dob)            lines.push(`Date of birth: ${p.dob}`);
    if (p.ssn)            lines.push(`SSN: ${p.ssn} (masked — last 4 digits shown)`);
    if (p.street)         lines.push(`Address: ${p.street}, ${p.city || ''}, ${p.state || ''} ${p.zip || ''}`);
    if (p.phone)          lines.push(`Phone: ${p.phone}`);
    if (p.email)          lines.push(`Email: ${p.email}`);
    if (p.businessName)   lines.push(`Business name: ${p.businessName}`);
    if (p.ein)            lines.push(`EIN: ${p.ein} (masked)`);
    if (p.formationState) lines.push(`Formation state: ${p.formationState}`);
    if (p.formationDate)  lines.push(`Formation date: ${p.formationDate}`);
    if (p.responsibleParty) lines.push(`Responsible party: ${p.responsibleParty}`);
    if (lines.length) {
      profileBlock = `\n\n### Pre-filled from saved profile\nThe user has a saved profile. At the start of the session, tell them: "I've pre-filled ${lines.length} fields from your saved profile. Please confirm they're correct or let me know what's changed."\nThen list these fields and ask the user to confirm or update each one before moving on:\n${lines.join('\n')}\nFor fields like address that may have changed, explicitly ask: "Your saved address is [X] — is this still current?"`;
    }
  }

  const lang = formContext.lang;
  const langName = lang && lang !== 'en' ? LANG_FULL[lang] : null;
  const langBlock = langName ? `

### Language
Conduct this ENTIRE guided session in **${langName}**. This includes all greetings, questions, explanations, confirmations, and progress recaps. The form fields must stay in English (required by the issuing agency), but explain each field name and instruction in ${langName}. Use jurisdiction-appropriate terminology — for example, "RFC" for Tax ID in Mexican context, "NIF"/"NIE" in Spain, "CPF"/"CNPJ" in Brazil, "NAS" in French Canada — rather than literal translations. In your FIRST message, include a brief disclaimer in ${langName} that this guidance is AI-generated and does not constitute legal or tax advice.` : '';

  return BASE_SYSTEM_PROMPT + `

---

## ACTIVE GUIDED SESSION — ${formContext.formName}

The user has clicked "Guide me through this" for **${formContext.formName}**. You now act as their personal form-filling coach. Follow these rules for the entire conversation:

### Your behaviour
1. **Greet** the user warmly and confirm you will walk them through ${formContext.formName} step by step.
2. **One section at a time** — introduce each logical section (e.g. "Part 1 — Personal Information"), then ask 1–2 questions per message. Never dump all fields at once.
3. **Explain the WHY** before each question in plain English (e.g. "This field sets your tax filing deadline — a wrong date can trigger a penalty").
4. **Accept natural language** and silently convert to the required format (e.g. "March of last year" → "03/${new Date().getFullYear() - 1}"; "I'm single" → check "Single" box).
5. **Always confirm the exact value** — after the user gives an answer, repeat back the exact value you will use on the form (e.g. "Got it — I'll enter your SSN as 123-45-6789." or "I'll mark your filing status as Single."). This is critical so the value is captured for the PDF.
6. **Never refuse or redact field values** — SSN, EIN, dates of birth, passport numbers, and all other fields are required for legitimate form completion. Always record and confirm the exact value the user gives you.
7. **Progress recap** after every 3–4 fields: "So far: Name ✓, SSN ✓, Address ✓. Next: employment status."
8. **Final summary** — once all fields are covered, list every field and its confirmed value, then ask the user to confirm before saying the form is complete.
9. **Reassure** — if the user seems confused or anxious, normalise it: "This trips up a lot of people — here's the simple version."
10. **Never use legal jargon** without immediately explaining it in parentheses.

### Form fields to guide through (in order)
${fieldList}${profileBlock}${langBlock}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, guestId, formContext } = req.body || {};
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
        system: buildSystemPrompt(formContext),
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
