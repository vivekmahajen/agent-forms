const { createKV, getSessionToken, isAdmin } = require('../_utils');
const kv = createKV();

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });

  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'session_expired' });

  const user = await kv.get(`user:${email}`);
  if (!isAdmin(user)) return res.status(403).json({ error: 'Admin only' });

  // Fetch all data in parallel
  const [rawUsers, formCounts, recentRaw, totalLookups] = await Promise.all([
    kv.zrange('users:index', 0, -1, { withScores: true, rev: true }),
    kv.hgetall('forms:count'),
    kv.lrange('lookups:recent', 0, 199),
    kv.llen('lookups:recent'),
  ]);

  // Parse users — Upstash returns alternating [member, score, member, score, ...]
  // but may also return [{member, score}, ...] depending on SDK version; handle both
  const users = [];
  if (Array.isArray(rawUsers)) {
    if (rawUsers.length > 0 && typeof rawUsers[0] === 'object' && rawUsers[0] !== null && 'member' in rawUsers[0]) {
      // Object format
      for (const entry of rawUsers) {
        const userRecord = await kv.get(`user:${entry.member}`);
        users.push({
          email: entry.member,
          registeredAt: userRecord?.registeredAt || new Date(entry.score).toISOString(),
          plan: userRecord?.plan || 'free',
        });
      }
    } else {
      // Flat alternating format
      for (let i = 0; i < rawUsers.length; i += 2) {
        const member = rawUsers[i];
        const score  = rawUsers[i + 1];
        const userRecord = await kv.get(`user:${member}`);
        users.push({
          email: member,
          registeredAt: userRecord?.registeredAt || new Date(Number(score)).toISOString(),
          plan: userRecord?.plan || 'free',
        });
      }
    }
  }

  // Parse recent lookups
  const recent = (recentRaw || []).map(item => {
    try { return typeof item === 'string' ? JSON.parse(item) : item; }
    catch { return null; }
  }).filter(Boolean);

  // Today's count
  const today = new Date().toISOString().split('T')[0];
  const todayCount = recent.filter(l => l.ts && l.ts.startsWith(today)).length;

  return res.status(200).json({
    users,
    formCounts: formCounts || {},
    recent,
    totalLookups: totalLookups || 0,
    todayLookups: todayCount,
  });
};
