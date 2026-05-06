const { kv } = require('@vercel/kv');
const { getSessionToken } = require('./_utils');

module.exports = async function handler(req, res) {
  const token = getSessionToken(req);
  if (token) await kv.del(`session:${token}`);
  res.setHeader('Set-Cookie', 'formiq_session=; HttpOnly; Path=/; Max-Age=0');
  return res.status(200).json({ success: true });
};
