const { createKV, getSessionToken } = require('./_utils');
const kv = createKV();

function maskSsn(ssn) {
  if (!ssn) return '';
  const d = ssn.replace(/\D/g, '');
  return d.length >= 4 ? '***-**-' + d.slice(-4) : '***-**-****';
}

function maskEin(ein) {
  if (!ein) return '';
  const d = ein.replace(/\D/g, '');
  return d.length >= 4 ? '**-***' + d.slice(-4) : '**-*****';
}

function applyMask(profile) {
  const out = Object.assign({}, profile);
  if (out.ssn) out.ssn = maskSsn(out.ssn);
  if (out.ein) out.ein = maskEin(out.ein);
  return out;
}

module.exports = async function handler(req, res) {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });

  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'session_expired' });

  const profileKey = `profile:${email}`;

  if (req.method === 'GET') {
    const profile = (await kv.get(profileKey)) || {};
    return res.status(200).json({ profile: applyMask(profile) });
  }

  if (req.method === 'POST') {
    const updates = req.body || {};
    const existing = (await kv.get(profileKey)) || {};

    // Never overwrite real SSN/EIN with a masked value sent back from the browser
    if (updates.ssn && updates.ssn.includes('*')) delete updates.ssn;
    if (updates.ein && updates.ein.includes('*')) delete updates.ein;

    // Strip unknown/dangerous keys
    const ALLOWED = ['fullName','dob','ssn','street','city','state','zip',
                     'businessName','ein','formationState','formationDate',
                     'responsibleParty','phone','email'];
    const sanitized = {};
    for (const k of ALLOWED) {
      if (updates[k] !== undefined) sanitized[k] = String(updates[k]).slice(0, 200);
    }

    const merged = Object.assign({}, existing, sanitized, { updatedAt: new Date().toISOString() });
    await kv.set(profileKey, merged);
    return res.status(200).json({ profile: applyMask(merged), saved: true });
  }

  return res.status(405).end();
};
