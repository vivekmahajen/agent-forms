const { createKV, hashPassword, createSalt } = require('../_utils');
const kv = createKV();

module.exports = async function handler(req, res) {
  // Accept GET so it can be triggered by visiting the URL in a browser
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const existing = await kv.get('user:admin');
  if (existing) {
    return res.status(200).json({ message: 'Admin account already exists' });
  }

  const salt = createSalt();
  await kv.set('user:admin', {
    email: 'admin',
    passwordHash: hashPassword('manisha', salt),
    salt,
    registeredAt: new Date().toISOString(),
    plan: 'admin',
  });

  // Add to users index with score 0 so it sorts to the end (oldest)
  await kv.zadd('users:index', { score: 0, member: 'admin' });

  return res.status(200).json({ success: true, message: 'Admin account created. Login: admin / manisha' });
};
