const { createKV, getSessionToken } = require('./_utils');
const { PDFDocument } = require('pdf-lib');
const kv = createKV();

// Only allow direct downloads from official government and recognised form domains
const ALLOWED_DOMAINS = [
  'irs.gov', 'uscis.gov', 'state.gov', 'dol.gov', 'hhs.gov',
  'ed.gov', 'ssa.gov', 'va.gov', 'sba.gov', 'epa.gov', 'dhs.gov',
  'cbp.gov', 'ice.gov', 'fema.gov', 'opm.gov', 'ftc.gov',
  'sec.gov', 'treasury.gov', 'cms.gov', 'cdc.gov', 'usps.com',
];

function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
  } catch { return false; }
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bestMatch(aiName, pdfNames) {
  const n = norm(aiName);
  // Exact normalised match
  for (const f of pdfNames) { if (norm(f) === n) return f; }
  // One contains the other
  for (const f of pdfNames) { const nf = norm(f); if (nf.includes(n) || n.includes(nf)) return f; }
  // Word overlap ≥ 2
  const aiWords = n.split(/(?=[A-Z])|\s+/).filter(Boolean);
  let best = null, bestScore = 1;
  for (const f of pdfNames) {
    const score = aiWords.filter(w => norm(f).includes(w)).length;
    if (score > bestScore) { best = f; bestScore = score; }
  }
  return best;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });

  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'session_expired' });

  const { pdfUrl, fields } = req.body || {};

  if (!pdfUrl || typeof pdfUrl !== 'string') {
    return res.status(400).json({ error: 'pdfUrl is required' });
  }
  if (!isAllowedUrl(pdfUrl)) {
    return res.status(400).json({ error: 'Only official government PDF URLs are supported.' });
  }

  let pdfBytes;
  try {
    const upstream = await fetch(pdfUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FormIQ/1.0; +https://formiq.app)' },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Could not download the official form (HTTP ' + upstream.status + '). The URL may have changed.' });
    }
    pdfBytes = new Uint8Array(await upstream.arrayBuffer());
  } catch (err) {
    return res.status(502).json({ error: 'Network error fetching form: ' + err.message });
  }

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (err) {
    return res.status(422).json({ error: 'Could not parse PDF: ' + err.message });
  }

  const form = pdfDoc.getForm();
  const pdfFields = form.getFields();
  let filled = 0;

  if (pdfFields.length > 0 && Array.isArray(fields) && fields.length > 0) {
    const names = pdfFields.map(f => f.getName());
    for (const { field, value } of fields) {
      const match = bestMatch(field, names);
      if (!match) continue;
      try {
        const pf = form.getField(match);
        const type = pf.constructor.name;
        if (type === 'PDFTextField') {
          pf.setText(String(value ?? ''));
          filled++;
        } else if (type === 'PDFCheckBox') {
          const v = String(value).toLowerCase();
          if (v === 'yes' || v === 'true' || v === 'x' || v === '1') { pf.check(); filled++; }
        } else if (type === 'PDFDropdown' || type === 'PDFOptionList') {
          const opts = pf.getOptions();
          const pick = opts.find(o => o.toLowerCase().includes(String(value).toLowerCase()));
          if (pick) { pf.select(pick); filled++; }
        } else if (type === 'PDFRadioGroup') {
          const opts = pf.getOptions();
          const pick = opts.find(o => o.toLowerCase().includes(String(value).toLowerCase()));
          if (pick) { pf.select(pick); filled++; }
        }
      } catch (_) { /* skip read-only or unknown fields */ }
    }
  }

  const out = await pdfDoc.save();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="filled-form.pdf"');
  res.setHeader('X-Fields-Filled', String(filled));
  return res.end(Buffer.from(out));
};
