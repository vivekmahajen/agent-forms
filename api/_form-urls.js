// Curated, verified PDF download URLs for common US government forms.
// These take priority over Claude's suggested URLs.
// null = form exists but has no downloadable fillable PDF (online-only or employer-generated).

const URLS = {
  // ── IRS ──────────────────────────────────────────────────────
  'w-9':        'https://www.irs.gov/pub/irs-pdf/fw9.pdf',
  'w9':         'https://www.irs.gov/pub/irs-pdf/fw9.pdf',
  'w-4':        'https://www.irs.gov/pub/irs-pdf/fw4.pdf',
  'w4':         'https://www.irs.gov/pub/irs-pdf/fw4.pdf',
  'w-2':        null,  // employer-generated
  'w2':         null,
  'w-8ben':     'https://www.irs.gov/pub/irs-pdf/fw8ben.pdf',
  'w8ben':      'https://www.irs.gov/pub/irs-pdf/fw8ben.pdf',
  '1040':       'https://www.irs.gov/pub/irs-pdf/f1040.pdf',
  '1040-sr':    'https://www.irs.gov/pub/irs-pdf/f1040sr.pdf',
  '1040-es':    'https://www.irs.gov/pub/irs-pdf/f1040es.pdf',
  '1040-x':     'https://www.irs.gov/pub/irs-pdf/f1040x.pdf',
  '1040x':      'https://www.irs.gov/pub/irs-pdf/f1040x.pdf',
  '1040es':     'https://www.irs.gov/pub/irs-pdf/f1040es.pdf',
  'ss-4':       'https://www.irs.gov/pub/irs-pdf/fss4.pdf',
  'ss4':        'https://www.irs.gov/pub/irs-pdf/fss4.pdf',
  '4506-t':     'https://www.irs.gov/pub/irs-pdf/f4506t.pdf',
  '4506t':      'https://www.irs.gov/pub/irs-pdf/f4506t.pdf',
  '4506-c':     'https://www.irs.gov/pub/irs-pdf/f4506c.pdf',
  '2553':       'https://www.irs.gov/pub/irs-pdf/f2553.pdf',
  '8821':       'https://www.irs.gov/pub/irs-pdf/f8821.pdf',
  '2848':       'https://www.irs.gov/pub/irs-pdf/f2848.pdf',
  '8962':       'https://www.irs.gov/pub/irs-pdf/f8962.pdf',
  '8949':       'https://www.irs.gov/pub/irs-pdf/f8949.pdf',
  '8863':       'https://www.irs.gov/pub/irs-pdf/f8863.pdf',
  '8889':       'https://www.irs.gov/pub/irs-pdf/f8889.pdf',
  '8606':       'https://www.irs.gov/pub/irs-pdf/f8606.pdf',
  '1099-misc':  'https://www.irs.gov/pub/irs-pdf/f1099msc.pdf',
  '1099misc':   'https://www.irs.gov/pub/irs-pdf/f1099msc.pdf',
  '1099-nec':   'https://www.irs.gov/pub/irs-pdf/f1099nec.pdf',
  '1099nec':    'https://www.irs.gov/pub/irs-pdf/f1099nec.pdf',
  '1099-int':   'https://www.irs.gov/pub/irs-pdf/f1099int.pdf',
  '1099int':    'https://www.irs.gov/pub/irs-pdf/f1099int.pdf',
  '1099-div':   'https://www.irs.gov/pub/irs-pdf/f1099div.pdf',
  '1099div':    'https://www.irs.gov/pub/irs-pdf/f1099div.pdf',
  '1099-r':     'https://www.irs.gov/pub/irs-pdf/f1099r.pdf',
  '1099r':      'https://www.irs.gov/pub/irs-pdf/f1099r.pdf',
  'schedule-a': 'https://www.irs.gov/pub/irs-pdf/f1040sa.pdf',
  'schedule-b': 'https://www.irs.gov/pub/irs-pdf/f1040sb.pdf',
  'schedule-c': 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf',
  'schedule-d': 'https://www.irs.gov/pub/irs-pdf/f1040sd.pdf',
  'schedule-e': 'https://www.irs.gov/pub/irs-pdf/f1040se.pdf',

  // ── USCIS ────────────────────────────────────────────────────
  'i-9':   'https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf',
  'i9':    'https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf',
  'i-765': 'https://www.uscis.gov/sites/default/files/document/forms/i765.pdf',
  'i765':  'https://www.uscis.gov/sites/default/files/document/forms/i765.pdf',
  'i-130': 'https://www.uscis.gov/sites/default/files/document/forms/i-130.pdf',
  'i130':  'https://www.uscis.gov/sites/default/files/document/forms/i-130.pdf',
  'i-485': 'https://www.uscis.gov/sites/default/files/document/forms/i-485.pdf',
  'i485':  'https://www.uscis.gov/sites/default/files/document/forms/i-485.pdf',
  'i-131': 'https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf',
  'i131':  'https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf',
  'i-864': 'https://www.uscis.gov/sites/default/files/document/forms/i-864.pdf',
  'i864':  'https://www.uscis.gov/sites/default/files/document/forms/i-864.pdf',
  'i-90':  'https://www.uscis.gov/sites/default/files/document/forms/i-90.pdf',
  'i90':   'https://www.uscis.gov/sites/default/files/document/forms/i-90.pdf',
  'n-400': 'https://www.uscis.gov/sites/default/files/document/forms/n-400.pdf',
  'n400':  'https://www.uscis.gov/sites/default/files/document/forms/n-400.pdf',
  'n-600': 'https://www.uscis.gov/sites/default/files/document/forms/n-600.pdf',
  'n600':  'https://www.uscis.gov/sites/default/files/document/forms/n-600.pdf',

  // ── State Department ─────────────────────────────────────────
  'ds-11':  'https://eforms.state.gov/Forms/ds11.pdf',
  'ds11':   'https://eforms.state.gov/Forms/ds11.pdf',
  'ds-82':  'https://eforms.state.gov/Forms/ds82.pdf',
  'ds82':   'https://eforms.state.gov/Forms/ds82.pdf',
  'ds-64':  'https://eforms.state.gov/Forms/ds64.pdf',
  'ds64':   'https://eforms.state.gov/Forms/ds64.pdf',
  'ds-160': null,  // online only
  'ds160':  null,

  // ── SSA ──────────────────────────────────────────────────────
  'ssa-827':  'https://www.ssa.gov/forms/ssa-827.pdf',
  'ssa827':   'https://www.ssa.gov/forms/ssa-827.pdf',
  'ss-5':     'https://www.ssa.gov/forms/ss-5.pdf',
  'ss5':      'https://www.ssa.gov/forms/ss-5.pdf',
  'ssa-44':   'https://www.ssa.gov/forms/ssa-44.pdf',
  'ssa44':    'https://www.ssa.gov/forms/ssa-44.pdf',

  // ── VA ───────────────────────────────────────────────────────
  '21-526ez': 'https://www.vba.va.gov/pubs/forms/VBA-21-526EZ-ARE.pdf',
  '21526ez':  'https://www.vba.va.gov/pubs/forms/VBA-21-526EZ-ARE.pdf',
  '21-22':    'https://www.vba.va.gov/pubs/forms/VBA-21-22-ARE.pdf',
  '2122':     'https://www.vba.va.gov/pubs/forms/VBA-21-22-ARE.pdf',

  // ── DOL / FMLA ───────────────────────────────────────────────
  'wh-380-e': 'https://www.dol.gov/sites/dolgov/files/WHD/legacy/files/wh380E.pdf',
  'wh380e':   'https://www.dol.gov/sites/dolgov/files/WHD/legacy/files/wh380E.pdf',
  'wh-380-f': 'https://www.dol.gov/sites/dolgov/files/WHD/legacy/files/wh380F.pdf',
  'wh-381':   'https://www.dol.gov/sites/dolgov/files/WHD/legacy/files/wh381.pdf',

  // ── FAFSA ────────────────────────────────────────────────────
  'fafsa': null,  // online only at studentaid.gov

  // ── HHS / CMS ────────────────────────────────────────────────
  'cms-1500': 'https://www.cms.gov/files/document/cms-1500-claim-form.pdf',
  'cms1500':  'https://www.cms.gov/files/document/cms-1500-claim-form.pdf',
  'ub-04':    'https://www.cms.gov/files/document/ub-04-form.pdf',
};

// Normalise a form name to the map key
function normalise(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/^(irs\s+form\s*|irs\s+|form\s+|uscis\s+|us\s+)/i, '')
    .replace(/\s+/g, '-')
    .trim();
}

// Returns the curated URL (string), null (explicitly no PDF), or undefined (not in map)
function lookupPdfUrl(formName) {
  if (!formName) return undefined;
  const key = normalise(formName);
  if (Object.prototype.hasOwnProperty.call(URLS, key)) return URLS[key];
  const bare = key.replace(/-/g, '');
  if (Object.prototype.hasOwnProperty.call(URLS, bare)) return URLS[bare];
  return undefined;
}

module.exports = { lookupPdfUrl };
