const { kv } = require('@vercel/kv');
const { getSessionToken, isTrialExpired, getTrialDaysLeft, getTodayKey, DAILY_LIMIT } = require('./_utils');

module.exports = async function handler(req, res) {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const email = await kv.get(`session:${token}`);
  if (!email) return res.status(401).json({ error: 'Session expired' });

  const user = await kv.get(`user:${email}`);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const today = getTodayKey();
  const dailyCount = (await kv.get(`usage:${email}:${today}`)) || 0;
  const trialExpired = isTrialExpired(user);
  const daysLeft = user.plan === 'free' ? getTrialDaysLeft(user) : null;

  return res.status(200).json({
    email: user.email,
    plan: user.plan,
    registeredAt: user.registeredAt,
    trialExpired,
    daysLeft,
    dailyCount,
    dailyLimit: user.plan === 'free' ? DAILY_LIMIT : null,
  });
};
