const { createKV, getSessionToken, isAdmin, isTrialExpired, getTodayKey, DAILY_LIMIT } = require('./_utils');
const { lookupPdfUrl } = require('./_form-urls');
const kv = createKV();

const LANG_FULL = {
  es: 'Spanish', pt: 'Portuguese', fr: 'French', zh: 'Mandarin Chinese',
  vi: 'Vietnamese', tl: 'Tagalog', ko: 'Korean', ar: 'Arabic',
};

const SYSTEM_PROMPT = `You are FormIQ, an expert assistant specialising in explaining official forms — government, tax, immigration, HR, medical, and legal.

When given a form name, return a structured JSON object with EXACTLY this shape:

{
  "found": true,
  "form_name": "Official full name of the form",
  "common_name": "What people commonly call it",
  "issued_by": "The agency or organisation that issues it",
  "purpose": "2-3 sentence plain English explanation of what this form is for",
  "who_needs_it": ["bullet 1", "bullet 2", "bullet 3"],
  "deadline": "When it must be filed, or null if not applicable",
  "where_to_submit": "Where to send or submit it, or null if not applicable",
  "official_pdf_url": "Direct https:// URL to download the blank official PDF form. Must be a direct PDF download link, not an HTML page. Return null if the form is online-only, employer-generated, or you are not certain of the exact URL.",
  "related_forms": [
    Include 3-6 forms that are directly associated with this form — forms that must be filed together,
    are commonly needed alongside it, are prerequisites, or are follow-up forms.
    Order by relevance (most essential first).
    {
      "form_name": "Short identifier as commonly used (e.g. 'Schedule C', 'Form W-2', 'I-94')",
      "full_name": "Official full name of the related form",
      "relationship": "One of exactly: Required with | Often filed together | May be required | Prerequisite | Follow-up form | Alternative",
      "reason": "1-2 sentences explaining exactly when and why someone filling the main form would also need this one"
    }
  ],
  "context": {
    "key_facts": ["3-5 critical facts every filer must know — deadlines, thresholds, eligibility rules, special cases"],
    "penalties": "What penalties, fines, or consequences apply for errors, late filing, or non-filing. Be specific with amounts where known. Or null.",
    "recent_changes": "Any notable changes, updates, or new requirements in the last 2 years. Or null if no significant changes.",
    "who_qualifies": "Any income limits, eligibility criteria, or exceptions that determine who must or must not file this form. Or null.",
    "useful_links": [
      {
        "label": "Short descriptive label (e.g. 'Official Instructions', 'IRS Publication 15')",
        "url": "https://... (must be a real, stable government or official URL)"
      }
    ]
  },
  "instructions": [
    CRITICAL: Include an entry for EVERY SINGLE field printed on the form — no exceptions.
    This includes: all numbered boxes, checkboxes, signature lines, date fields, part headers
    with sub-fields, optional fields, and certification blocks. Do NOT skip any field even if
    it seems obvious or optional. List fields in the same order they appear on the form.
    {
      "field": "Exact label as printed on the form, including box number if present (e.g. 'Box 1 — Wages, tips, other compensation')",
      "instruction": "Specific, actionable Plain English instruction for exactly this field. Mention what to enter, where to find the value, and what format to use.",
      "warning": "The single most common mistake people make on this specific field, or null if none"
    }
  ],
  "tips": ["tip 1", "tip 2", "tip 3"],
  "sample": [
    CRITICAL RULES FOR SAMPLE DATA:
    1. Every field listed in instructions MUST have a matching entry here.
    2. Use this consistent fictional person throughout — never vary:
       Name: Alex Rivera | DOB: March 15, 1985 | SSN: 000-00-1234
       Address: 142 Maple Street, Austin, TX 78701 | Phone: (512) 555-0182
       Email: alex.rivera@brightpath.com | Occupation: Senior Project Manager
       Employer: Brightpath Solutions Inc | EIN: 47-2381650
       Employer address: 980 Congress Ave, Austin, TX 78701 | Employer phone: (512) 555-9200
       Spouse: Jordan Rivera | DOB: June 4, 1983 | SSN: 000-00-5678
       Bank: First National Bank | Routing: 121000248 | Account ending: 4821
       Passport: Z12345678 (issued Jan 10 2020, expires Jan 9 2030)
       Country of birth: United States | Citizenship: U.S. Citizen
    3. Values must be realistic and form-appropriate — not generic placeholders like "Enter value here".
    4. For dollar amounts use realistic figures consistent with the occupation (e.g. salary ~$92,000/yr).
    5. For dates use specific dates (e.g. "03/15/1985") not vague ranges.
    6. For checkboxes write exactly "Yes", "No", or the option to select.
    7. Match field names exactly to the instructions list.
    {
      "field": "Exact field label matching the instructions entry",
      "value": "Specific, realistic value for Alex Rivera"
    }
  ]
}

If you do not recognise the form name or cannot provide reliable information, return:
{
  "found": false,
  "message": "Brief explanation of why the form wasn't found"
}

Return ONLY valid JSON. No markdown, no backticks, no preamble, no explanation outside the JSON object.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });

  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'session_expired' });

  const user = await kv.get(`user:${email}`);
  if (!user) return res.status(401).json({ error: 'user_not_found' });

  if (!isAdmin(user)) {
    if (user.plan === 'free') {
      if (isTrialExpired(user)) {
        return res.status(403).json({
          error: 'trial_expired',
          message: 'Your 7-day free trial has ended. Upgrade to Pro to continue.',
        });
      }

      const today = getTodayKey();
      const usageKey = `usage:${email}:${today}`;
      const dailyCount = (await kv.get(usageKey)) || 0;

      if (dailyCount >= DAILY_LIMIT) {
        return res.status(429).json({
          error: 'daily_limit',
          message: `You've used all ${DAILY_LIMIT} lookups for today. Come back tomorrow or upgrade to Pro.`,
        });
      }

      await kv.set(usageKey, dailyCount + 1, { ex: 25 * 60 * 60 });
    }
  }

  const { formName, lang } = req.body || {};
  if (!formName || typeof formName !== 'string') {
    return res.status(400).json({ error: 'formName is required' });
  }
  const langName = lang && lang !== 'en' ? LANG_FULL[lang] : null;

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Form name: ${formName}${langName ? `\n\nFor each entry in "instructions" and "sample", add a "translated_label" field containing the field label in ${langName}. Use jurisdiction-appropriate terminology (e.g., "RFC" for Tax ID in Mexican Spanish context, "NIF"/"NIE" in Spain, "CPF"/"CNPJ" in Brazil, "NAS" in French Canada). The "field" value stays in English; only "translated_label" is in ${langName}.` : ''}` }],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json({ error: err?.error?.message || 'Upstream API error' });
    }

    const data = await upstream.json();

    // Inject a verified PDF URL, overriding Claude's potentially stale suggestion
    try {
      const textBlock = (data.content || []).find(b => b.type === 'text');
      if (textBlock) {
        const parsed = JSON.parse(textBlock.text);
        if (parsed.found) {
          const curated = lookupPdfUrl(formName) ?? lookupPdfUrl(parsed.form_name);
          if (typeof curated !== 'undefined') {
            parsed.official_pdf_url = curated;
            textBlock.text = JSON.stringify(parsed);
          }
        }
      }
    } catch (_) { /* non-critical */ }

    // Log lookup for admin reporting (fire-and-forget, non-blocking)
    const logEntry = JSON.stringify({ email, formName, ts: new Date().toISOString() });
    Promise.all([
      kv.lpush('lookups:recent', logEntry).then(() => kv.ltrim('lookups:recent', 0, 999)),
      kv.hincrby('forms:count', formName.toLowerCase().trim(), 1),
    ]).catch(() => {});

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
