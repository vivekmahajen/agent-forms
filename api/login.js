import { kv } from '@vercel/kv';
import { hashPassword, createToken, SESSION_TTL } from './_utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await kv.get(`user:${normalizedEmail}`);

  if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = createToken();
  await kv.set(`session:${token}`, normalizedEmail, { ex: SESSION_TTL });

  res.setHeader('Set-Cookie', `formiq_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL}`);
  return res.status(200).json({ success: true, plan: user.plan });
}
