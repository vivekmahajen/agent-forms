import { kv } from '@vercel/kv';
import { hashPassword, createSalt, createToken, SESSION_TTL } from './_utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const userKey = `user:${normalizedEmail}`;

  const existing = await kv.get(userKey);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const salt = createSalt();
  await kv.set(userKey, {
    email: normalizedEmail,
    passwordHash: hashPassword(password, salt),
    salt,
    registeredAt: new Date().toISOString(),
    plan: 'free',
  });

  const token = createToken();
  await kv.set(`session:${token}`, normalizedEmail, { ex: SESSION_TTL });

  res.setHeader('Set-Cookie', `formiq_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL}`);
  return res.status(200).json({ success: true });
}
