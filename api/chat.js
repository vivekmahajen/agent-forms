const { createKV, getSessionToken } = require('./_utils');
const kv = createKV();

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

const LANG_FULL = {
  es: 'Spanish', pt: 'Portuguese', fr: 'French', zh: 'Mandarin Chinese',
  vi: 'Vietnamese', tl: 'Tagalog', ko: 'Korean', ar: 'Arabic',
};

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

  // Language instruction block
  const lang = formContext.lang;
  const langName = lang && lang !== 'en' ? LANG_FULL[lang] : null;
  const langBlock = langName ? `

---

## LANGUAGE REQUIREMENT

Conduct this ENTIRE conversation in **${langName}**. Every response, question, explanation, field label, recap, and summary MUST be in ${langName}.

Key rules:
- Use jurisdiction-appropriate legal and tax terminology — do NOT translate literally. For example, in Spanish use "número de seguro social", "número de identificación del empleador", "estado civil tributario", "declaración de impuestos"; in French use "numéro de sécurité sociale", "numéro SIRET/SIREN"; in Arabic use "الرقم الضريبي", "الضمان الاجتماعي".
- All form field VALUES that the user provides must remain in English format as required by the issuing agency (e.g. dates as MM/DD/YYYY, names in Roman characters).
- In your VERY FIRST message, include a disclaimer in ${langName}: "⚠️ Cette orientation est générée par IA à titre informatif uniquement et ne constitue pas un conseil juridique, fiscal ou d'immigration. Veuillez toujours vérifier auprès de l'agence officielle ou d'un professionnel qualifié." — but translate this disclaimer INTO ${langName} (do not use French unless ${langName} is French).` : '';

  return BASE_SYSTEM_PROMPT + langBlock + `

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

### Validation rules — apply before accepting any value
When the user provides a value for any field, validate it silently and only proceed if it's valid. Respond in plain English — never use error codes or technical jargon.

**Format checks:**
- **SSN / ITIN** — must be exactly 123-45-6789 (3 digits, dash, 2 digits, dash, 4 digits). If wrong: "That doesn't look like a valid SSN — it should be in the format 123-45-6789. Could you re-enter it?"
- **EIN** — must be exactly 12-3456789 (2 digits, dash, 7 digits). If wrong: "That doesn't look like a valid EIN — it should be formatted like 12-3456789."
- **Dates** — must be a real calendar date in MM/DD/YYYY format. Reject impossible dates (Feb 30, Apr 31, month > 12, day = 0). Say: "That date doesn't seem right — [specific reason, e.g., 'February only has 28 days in non-leap years']. Could you double-check?"
- **ZIP codes** — must be exactly 5 digits (e.g. 10001) or 9 digits with a dash (e.g. 10001-1234). Flag 4-digit or 6-digit entries.
- **State abbreviations** — must be a valid 2-letter US state or territory code (e.g. TX, CA, NY, DC, PR, GU). Do not accept ambiguous full names without confirming the abbreviation.

**Logic checks:**
- **Business start date in the future** — if the date provided is after today, ask: "That date is in the future. Did you mean to enter a past date, or is this a business that hasn't started yet?"
- **Zero employees but wages date filled** — if the user enters 0 for all employee counts (household, agricultural, and other) yet also provides a first wages date, ask: "You've entered 0 employees but also provided a first wages date. Could you clarify — did you mean to enter employees under one of the categories?"
- **Sole proprietor + EIN as responsible party number** — if entity type is "sole proprietor" (or "individual / sole proprietor") but the responsible party's tax ID is in EIN format (XX-XXXXXXX), say: "Sole proprietors normally use their personal SSN (format 123-45-6789) as the responsible party number, not an EIN. Did you mean to enter your SSN instead?"

### Form fields to guide through (in order)
${fieldList}${profileBlock}`;
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
