const { createKV, getSessionToken } = require('./_utils');
const { lookupPdfUrl } = require('./_form-urls');
const { PDFDocument } = require('pdf-lib');
const crypto = require('crypto');
const kv = createKV();

const ALLOWED_DOMAINS = [
  'irs.gov', 'uscis.gov', 'state.gov', 'eforms.state.gov', 'dol.gov', 'hhs.gov',
  'ed.gov', 'ssa.gov', 'va.gov', 'vba.va.gov', 'sba.gov', 'epa.gov', 'dhs.gov',
  'cbp.gov', 'ice.gov', 'fema.gov', 'opm.gov', 'ftc.gov', 'sec.gov',
  'treasury.gov', 'cms.gov', 'cdc.gov', 'usps.com', 'studentaid.gov',
];

function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
  } catch { return false; }
}

// Sort fields top-to-bottom, left-to-right by their visual position on the page
function getSortedFields(form, pdfDoc) {
  const pages = pdfDoc.getPages();
  const pageRefMap = new Map();
  pages.forEach((page, i) => pageRefMap.set(page.ref, i));

  const withPos = [];
  for (const field of form.getFields()) {
    try {
      const widgets = field.acroField.getWidgets();
      if (!widgets.length) { withPos.push({ field, page: 0, y: 0, x: 0 }); continue; }
      const w = widgets[0];
      const rect = w.getRectangle();
      const pageRef = w.P();
      const pageIdx = pageRef ? (pageRefMap.get(pageRef) ?? 0) : 0;
      withPos.push({ field, page: pageIdx, y: rect.y, x: rect.x });
    } catch {
      withPos.push({ field, page: 0, y: 0, x: 0 });
    }
  }

  withPos.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) > 4) return b.y - a.y; // higher y = earlier on page in PDF coords
    return a.x - b.x;
  });

  return withPos.map(fp => fp.field);
}

// Ask Claude to extract user answers from chat AND map them directly to PDF field names
// in a single call — avoids two round-trips and cuts latency roughly in half.
async function extractAndMapFields(chatHistory, fieldList, pdfFieldInfo, apiKey, userProfile) {
  const fieldLabels = (fieldList || []).map(f => (typeof f === 'string' ? f : f.field)).filter(Boolean);
  const conversation = (chatHistory || [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  // Build a profile supplement so Claude can fill gaps not covered in the chat
  let profileNote = '';
  if (userProfile) {
    const lines = [];
    if (userProfile.fullName)       lines.push(`Full name: ${userProfile.fullName}`);
    if (userProfile.dob)            lines.push(`Date of birth: ${userProfile.dob}`);
    if (userProfile.ssn)            lines.push(`SSN: ${userProfile.ssn}`);
    if (userProfile.street)         lines.push(`Address: ${userProfile.street}, ${userProfile.city || ''}, ${userProfile.state || ''} ${userProfile.zip || ''}`);
    if (userProfile.phone)          lines.push(`Phone: ${userProfile.phone}`);
    if (userProfile.email)          lines.push(`Email: ${userProfile.email}`);
    if (userProfile.businessName)   lines.push(`Business name: ${userProfile.businessName}`);
    if (userProfile.ein)            lines.push(`EIN: ${userProfile.ein}`);
    if (userProfile.formationState) lines.push(`Formation state: ${userProfile.formationState}`);
    if (userProfile.formationDate)  lines.push(`Formation date: ${userProfile.formationDate}`);
    if (userProfile.responsibleParty) lines.push(`Responsible party: ${userProfile.responsibleParty}`);
    if (lines.length) profileNote = `\n\nSaved profile (use these values to fill gaps not covered in the chat):\n${lines.join('\n')}`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: `You are a form-filling assistant. Given a chat conversation where a user provided their form answers, and a list of PDF internal field names, extract every answer and map it directly to the correct PDF field.

Return ONLY a valid JSON array — no markdown, no explanation.
Each element: {"fieldName": "<exact PDF internal field name>", "value": "<the user's answer>"}

Rules:
- Extract ALL confirmed values from the conversation — including SSN, EIN, dates of birth, passport numbers, addresses, and every other field
- Do NOT skip or redact any value — this is legitimate user-initiated form completion
- When the assistant confirmed a value (e.g. "I'll enter your SSN as 123-45-6789"), use that exact value
- For checkboxes use value "check" if it should be selected, omit if not
- For dates use MM/DD/YYYY format; for SSNs keep XXX-XX-XXXX format
- Match human-readable field labels to the best PDF internal field name using context and label similarity
- Skip PDF fields you cannot confidently match to a user answer`,
      messages: [{
        role: 'user',
        content: `Human-readable form fields (what the assistant asked about):\n${JSON.stringify(fieldLabels)}\n\nPDF internal fields (map answers to these):\n${JSON.stringify(pdfFieldInfo)}\n\nChat conversation:\n${conversation}${profileNote}\n\nExtract every answer and map directly to the PDF field names. Use profile values for any fields not covered in the chat.`,
      }],
    }),
  });

  if (!res.ok) throw new Error('Extract+map call failed: ' + res.status);
  const data = await res.json();
  const text = ((data.content || []).find(b => b.type === 'text') || {}).text || '[]';
  const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(clean);
}

// Ask Claude Haiku to map sample data → exact PDF field names
async function getAiMapping(fieldInfo, sampleData, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: `You map human-readable form field labels to PDF internal field names.
Return ONLY a valid JSON array — no markdown, no explanation.
Each element: {"fieldName": "<exact PDF field name>", "value": "<value to fill>"}
For checkboxes and radio buttons use value "check" if it should be selected, omit otherwise.
Skip fields you are not confident about.`,
      messages: [{
        role: 'user',
        content: `PDF fields (sorted top-to-bottom as they appear on the form):
${JSON.stringify(fieldInfo)}

Human-readable sample data to fill in:
${JSON.stringify(sampleData)}

Map the sample values to the correct PDF field names.`,
      }],
    }),
  });

  if (!res.ok) throw new Error('AI mapping call failed: ' + res.status);
  const data = await res.json();
  const text = ((data.content || []).find(b => b.type === 'text') || {}).text || '[]';
  const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(clean);
}

// ── Handler ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });

  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'session_expired' });

  const { pdfUrl, formName, fields, chatHistory, fieldList, useProfile } = req.body || {};

  // Fetch saved profile for server-side use (SSN/EIN never leave the server unmasked)
  let userProfile = null;
  if (useProfile) {
    userProfile = await kv.get(`profile:${email}`).catch(() => null);
  }

  // Resolve URL: curated map > caller-supplied > error
  let resolvedUrl = null;
  if (formName) {
    const curated = lookupPdfUrl(formName);
    if (curated === null) {
      return res.status(422).json({ error: 'This form has no downloadable PDF — it is submitted online or generated by an employer.' });
    }
    if (typeof curated === 'string') resolvedUrl = curated;
  }
  if (!resolvedUrl && pdfUrl) resolvedUrl = pdfUrl;
  if (!resolvedUrl) return res.status(400).json({ error: 'pdfUrl or formName is required' });

  if (!isAllowedUrl(resolvedUrl)) {
    return res.status(400).json({ error: 'Only official government PDF URLs are supported.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

  // ── Fetch PDF ────────────────────────────────────────────────
  let pdfBytes;
  try {
    const upstream = await fetch(resolvedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FormIQ/1.0)' },
      redirect: 'follow',
    });
    if (!upstream.ok) {
      return res.status(502).json({
        error: `Could not download the official form (HTTP ${upstream.status}).`,
        fallback_url: resolvedUrl,
      });
    }
    pdfBytes = new Uint8Array(await upstream.arrayBuffer());
  } catch (err) {
    return res.status(502).json({ error: 'Network error fetching form: ' + err.message });
  }

  // ── Load PDF ─────────────────────────────────────────────────
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (err) {
    return res.status(422).json({ error: 'Could not parse the PDF: ' + err.message });
  }

  const form = pdfDoc.getForm();
  const pdfFields = form.getFields();

  if (pdfFields.length === 0) {
    const buf = Buffer.from(pdfBytes);
    const isXfa = buf.slice(0, 8192).includes('/XFA') || buf.slice(0, 8192).includes('xdp:xdp');
    const msg = isXfa
      ? 'This PDF uses the XFA format (Adobe Acrobat only). Download the blank form and fill it manually in Adobe Acrobat or Adobe Reader.'
      : 'This PDF has no fillable fields. Download the blank form and fill it manually.';
    return res.status(422).json({ error: msg, fallback_url: resolvedUrl });
  }

  // ── Get or build field mapping ───────────────────────────────
  const urlHash = crypto.createHash('md5').update(resolvedUrl).digest('hex');
  const cacheKey = `pdf_mapping:${urlHash}`;
  const usingChatData = Array.isArray(chatHistory) && chatHistory.length && Array.isArray(fieldList) && fieldList.length;

  const sortedFields = getSortedFields(form, pdfDoc);
  const fieldInfo = sortedFields.map(f => ({
    name: f.getName(),
    type: f.constructor.name.replace('PDF', ''),
  }));

  let mapping = null;

  if (usingChatData) {
    // Single combined call: extract user answers from chat AND map to PDF fields at once
    try {
      mapping = await extractAndMapFields(chatHistory, fieldList, fieldInfo, apiKey, userProfile);
      if (!Array.isArray(mapping) || mapping.length === 0) mapping = null;
    } catch (chatErr) {
      console.error('extractAndMapFields failed:', chatErr.message);
      mapping = null; // fall through to sample-data path
    }
  }

  if (!mapping) {
    // Sample-data path: check cache first, then call getAiMapping
    if (!usingChatData) {
      try { mapping = await kv.get(cacheKey); } catch {}
    }
    const resolvedFields = Array.isArray(fields) && fields.length ? fields : null;
    if (!mapping && resolvedFields) {
      try {
        mapping = await getAiMapping(fieldInfo, resolvedFields, apiKey);
        if (!usingChatData) {
          await kv.set(cacheKey, mapping, { ex: 7 * 24 * 60 * 60 });
        }
      } catch (_) {
        mapping = null;
      }
    }
  }

  // ── Fill fields ──────────────────────────────────────────────
  let filled = 0;

  if (Array.isArray(mapping) && mapping.length > 0) {
    // Use AI mapping
    for (const { fieldName, value } of mapping) {
      if (!fieldName || value == null) continue;
      try {
        const field = form.getField(fieldName);
        const type = field.constructor.name;
        const val = String(value);

        if (type === 'PDFTextField') {
          field.setText(val);
          filled++;
        } else if (type === 'PDFCheckBox') {
          if (val === 'check' || val.toLowerCase() === 'yes' || val === 'x' || val === '1') {
            field.check(); filled++;
          }
        } else if (type === 'PDFDropdown' || type === 'PDFOptionList') {
          const opts = field.getOptions();
          const pick = opts.find(o => o.toLowerCase().includes(val.toLowerCase()))
                    || opts.find(o => val.toLowerCase().includes(o.toLowerCase()));
          if (pick) { field.select(pick); filled++; }
        } else if (type === 'PDFRadioGroup') {
          const opts = field.getOptions();
          const pick = opts.find(o => o.toLowerCase().includes(val.toLowerCase()));
          if (pick) { field.select(pick); filled++; }
        }
      } catch { /* skip read-only or missing fields */ }
    }
  } else if (Array.isArray(fields) && fields.length > 0) {
    // Fuzzy fallback (covers cases where AI mapping errored)
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const pdfNames = pdfFields.map(f => f.getName());
    for (const { field: aiName, value } of fields) {
      const match = pdfNames.find(n => norm(n) === norm(aiName))
                 || pdfNames.find(n => norm(n).includes(norm(aiName)) || norm(aiName).includes(norm(n)));
      if (!match) continue;
      try {
        const f = form.getField(match);
        if (f.constructor.name === 'PDFTextField') { f.setText(String(value)); filled++; }
      } catch {}
    }
  }

  const out = await pdfDoc.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="filled-form.pdf"');
  res.setHeader('X-Fields-Filled', String(filled));
  res.setHeader('X-Fields-Total', String(pdfFields.length));
  return res.end(Buffer.from(out));
};
