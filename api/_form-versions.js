// Curated baseline form version data — verified against official agency PDFs.
// rev:      official revision identifier as printed on the form
// expires:  OMB or agency expiration date shown on the form, null if none
// upcoming: text describing a known announced upcoming revision, null if none
//
// These baselines are updated whenever /api/check-form-version fetches the
// official PDF and finds a newer revision (72-hour refresh TTL in Redis).

const VERSIONS = {
  // ── IRS ──────────────────────────────────────────────────────
  'ss-4':       { rev: 'December 2019',  expires: null,           upcoming: null },
  'w-9':        { rev: 'March 2024',     expires: null,           upcoming: null },
  'w-4':        { rev: '2024',           expires: null,           upcoming: null },
  'w-8ben':     { rev: 'October 2021',   expires: null,           upcoming: null },
  '1040':       { rev: '2023',           expires: null,           upcoming: null },
  '1040-sr':    { rev: '2023',           expires: null,           upcoming: null },
  '1040-x':     { rev: 'February 2024', expires: null,           upcoming: null },
  '1040-es':    { rev: '2024',           expires: null,           upcoming: null },
  '4506-t':     { rev: 'March 2024',     expires: null,           upcoming: null },
  '4506-c':     { rev: 'October 2022',   expires: null,           upcoming: null },
  '2553':       { rev: 'December 2017',  expires: null,           upcoming: null },
  '8821':       { rev: 'January 2021',   expires: null,           upcoming: null },
  '2848':       { rev: 'January 2021',   expires: null,           upcoming: null },
  '8962':       { rev: '2023',           expires: null,           upcoming: null },
  '8949':       { rev: '2023',           expires: null,           upcoming: null },
  '8863':       { rev: '2023',           expires: null,           upcoming: null },
  '8889':       { rev: '2023',           expires: null,           upcoming: null },
  '8606':       { rev: '2023',           expires: null,           upcoming: null },
  '1099-misc':  { rev: '2024',           expires: null,           upcoming: null },
  '1099-nec':   { rev: '2024',           expires: null,           upcoming: null },
  '1099-int':   { rev: '2024',           expires: null,           upcoming: null },
  '1099-div':   { rev: '2024',           expires: null,           upcoming: null },
  '1099-r':     { rev: '2024',           expires: null,           upcoming: null },
  'schedule-a': { rev: '2023',           expires: null,           upcoming: null },
  'schedule-b': { rev: '2023',           expires: null,           upcoming: null },
  'schedule-c': { rev: '2023',           expires: null,           upcoming: null },
  'schedule-d': { rev: '2023',           expires: null,           upcoming: null },
  'schedule-e': { rev: '2023',           expires: null,           upcoming: null },

  // ── USCIS ────────────────────────────────────────────────────
  'i-9':        { rev: '08/01/23',       expires: '07/31/26',     upcoming: null },
  'i-765':      { rev: '04/01/24',       expires: null,           upcoming: null },
  'i-130':      { rev: '04/01/24',       expires: null,           upcoming: null },
  'i-485':      { rev: '04/01/24',       expires: null,           upcoming: null },
  'i-131':      { rev: '04/01/24',       expires: null,           upcoming: null },
  'i-864':      { rev: '04/01/24',       expires: null,           upcoming: null },
  'i-90':       { rev: '01/13/23',       expires: null,           upcoming: null },
  'n-400':      { rev: '04/01/24',       expires: null,           upcoming: null },
  'n-600':      { rev: '04/01/24',       expires: null,           upcoming: null },

  // ── State Dept ───────────────────────────────────────────────
  'ds-11':      { rev: 'October 2023',   expires: '04-30-2026',   upcoming: null },
  'ds-82':      { rev: 'October 2023',   expires: '04-30-2026',   upcoming: null },
  'ds-64':      { rev: 'October 2023',   expires: null,           upcoming: null },

  // ── SSA ──────────────────────────────────────────────────────
  'ss-5':       { rev: 'December 2023',  expires: null,           upcoming: null },
  'ssa-827':    { rev: '2021',           expires: '09-30-2024',   upcoming: null },
  'ssa-44':     { rev: '2023',           expires: null,           upcoming: null },

  // ── VA ───────────────────────────────────────────────────────
  '21-526ez':   { rev: 'April 2023',     expires: null,           upcoming: null },
  '21-22':      { rev: 'June 2020',      expires: null,           upcoming: null },

  // ── DOL ──────────────────────────────────────────────────────
  'wh-380-e':   { rev: 'June 2020',      expires: null,           upcoming: null },
  'wh-380-f':   { rev: 'June 2020',      expires: null,           upcoming: null },
  'wh-381':     { rev: 'June 2020',      expires: null,           upcoming: null },

  // ── CMS ──────────────────────────────────────────────────────
  'cms-1500':   { rev: '02/12',          expires: null,           upcoming: null },
};

function normalise(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/^(irs\s+form\s*|irs\s+|form\s+|uscis\s+|us\s+)/i, '')
    .replace(/\s+/g, '-')
    .trim();
}

// Return curated version record for a form name (or null if unknown)
function lookupVersion(formName) {
  if (!formName) return null;
  const key = normalise(formName);
  if (Object.prototype.hasOwnProperty.call(VERSIONS, key)) return { ...VERSIONS[key], key };
  // Try without hyphens
  const bare = key.replace(/-/g, '');
  for (const k of Object.keys(VERSIONS)) {
    if (k.replace(/-/g, '') === bare) return { ...VERSIONS[k], key: k };
  }
  return null;
}

// Search first 32KB of a PDF's raw bytes for a revision/edition marker
function extractRevFromPdfBytes(bytes) {
  const slice = Buffer.from(bytes).slice(0, 32768).toString('latin1');

  let m;
  // IRS parenthesised: (Rev. December 2019) or (Rev. 12-2019)
  m = slice.match(/\(Rev\.\s+([A-Z][a-z]+(?: \d{4})?)\)/);
  if (m) return m[1];
  m = slice.match(/\(Rev\.\s+(\d{1,2}[- ]\d{4})\)/);
  if (m) return m[1];
  // IRS bare: Rev. December 2019
  m = slice.match(/Rev\.\s+([A-Z][a-z]+ \d{4})/);
  if (m) return m[1];
  m = slice.match(/Rev\.\s+(\d{1,2}[- ]\d{4})/);
  if (m) return m[1];
  // USCIS: Edition Date 08/01/23 or Edition 08/01/23
  m = slice.match(/Edition\s+(?:Date\s+)?(\d{2}\/\d{2}\/\d{2,4})/i);
  if (m) return m[1];
  // Fallback: any parenthesised rev annotation
  m = slice.match(/\(Rev\.?\s+([^)]{3,30})\)/i);
  if (m) return m[1].trim();

  return null;
}

// Pull a revision string out of Claude's docType description
// e.g. "IRS Form SS-4 (Rev. December 2019)" → "December 2019"
function parseRevFromDocType(docType) {
  if (!docType) return null;
  let m;
  m = docType.match(/Rev\.?\s+([A-Za-z]+ \d{4}|\d{1,2}[\/\-]\d{2,4})/i);
  if (m) return m[1];
  m = docType.match(/Tax\s+Year\s+(\d{4})/i);
  if (m) return 'Tax Year ' + m[1];
  m = docType.match(/Edition\s+(?:Date\s+)?(\d{2}\/\d{2}\/\d{2,4})/i);
  if (m) return m[1];
  return null;
}

// Normalise a revision string for comparison (case-insensitive, whitespace/dash agnostic)
function normaliseRev(rev) {
  return String(rev || '').toLowerCase().replace(/[\s\-]+/g, '-').trim();
}

function revsMismatch(a, b) {
  if (!a || !b) return false;
  return normaliseRev(a) !== normaliseRev(b);
}

module.exports = { lookupVersion, extractRevFromPdfBytes, parseRevFromDocType, revsMismatch };
