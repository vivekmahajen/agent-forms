const { createKV, getSessionToken } = require('./_utils');
const { lookupVersion, extractRevFromPdfBytes, revsMismatch } = require('./_form-versions');
const { lookupPdfUrl } = require('./_form-urls');
const kv = createKV();

const TTL_72H = 72 * 60 * 60;        // seconds
const ALLOWED_DOMAINS = [
  'irs.gov', 'uscis.gov', 'state.gov', 'eforms.state.gov', 'dol.gov',
  'ssa.gov', 'va.gov', 'vba.va.gov', 'cms.gov', 'ed.gov',
];

function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' &&
      ALLOWED_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
  } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });
  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'session_expired' });

  const { formName, pdfUrl: callerUrl } = req.body || {};
  if (!formName || typeof formName !== 'string') {
    return res.status(400).json({ error: 'formName is required' });
  }

  const curated = lookupVersion(formName);
  const cacheKey = `form_ver:${curated?.key || formName.toLowerCase().replace(/\s+/g, '-')}`;

  // ── Return cached data if still fresh ──────────────────────
  try {
    const cached = await kv.get(cacheKey);
    if (cached?.checkedAt) {
      const ageMs = Date.now() - new Date(cached.checkedAt).getTime();
      if (ageMs < TTL_72H * 1000) return res.status(200).json(cached);
    }
  } catch {}

  // ── Resolve PDF URL ─────────────────────────────────────────
  const resolvedUrl = lookupPdfUrl(formName)
    ?? (callerUrl && isAllowedUrl(callerUrl) ? callerUrl : null);

  if (!resolvedUrl) {
    // No PDF available — store curated data and return
    const result = buildResult(formName, curated, null, null, false);
    await kv.set(cacheKey, result, { ex: TTL_72H }).catch(() => {});
    return res.status(200).json(result);
  }

  // ── Fetch PDF and extract revision ──────────────────────────
  try {
    const r = await fetch(resolvedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FormIQ/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`PDF fetch ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const extractedRev = extractRevFromPdfBytes(bytes);

    // Compare to previously stored verified version (not curated baseline)
    let previousRev = null;
    let isUpdated = false;
    try {
      const prev = await kv.get(cacheKey);
      if (prev?.current?.rev && prev.current.source !== 'curated') {
        previousRev = prev.current.rev;
        if (extractedRev && revsMismatch(extractedRev, previousRev)) {
          isUpdated = true;
        }
      }
    } catch {}

    const result = buildResult(
      formName, curated,
      extractedRev ? { rev: extractedRev, source: 'verified' } : null,
      isUpdated ? previousRev : null,
      isUpdated,
    );
    await kv.set(cacheKey, result, { ex: TTL_72H }).catch(() => {});
    return res.status(200).json(result);

  } catch (err) {
    // PDF fetch failed — fall back to curated and cache briefly
    const result = buildResult(formName, curated, null, null, false, err.message);
    await kv.set(cacheKey, result, { ex: 3600 }).catch(() => {}); // 1h retry window
    return res.status(200).json(result);
  }
};

function buildResult(formName, curated, verified, previousRev, isUpdated, checkError) {
  return {
    formName,
    current: {
      rev:     verified?.rev     ?? curated?.rev     ?? null,
      expires: curated?.expires  ?? null,
      source:  verified ? 'verified' : 'curated',
    },
    previous: previousRev ? { rev: previousRev } : null,
    upcoming: curated?.upcoming ?? null,
    isUpdated,
    checkedAt: new Date().toISOString(),
    ...(checkError ? { checkError } : {}),
  };
}
