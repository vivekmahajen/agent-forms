const { kv } = require('@vercel/kv');
const crypto = require('crypto');

function parseCookies(req) {
  const list = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(c => {
    const parts = c.trim().split('=');
    const key = parts.shift().trim();
    if (key) list[key] = parts.join('=');
  });
  return list;
}

function getSessionToken(req) {
  return parseCookies(req).formiq_session;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isTrialExpired(user) {
  if (user.plan !== 'free') return false;
  const expiry = new Date(user.registeredAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  return Date.now() > expiry;
}

function getTrialDaysLeft(user) {
  const expiry = new Date(user.registeredAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000)));
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

async function getAuthUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const email = await kv.get(`session:${token}`);
  if (!email) return null;
  return kv.get(`user:${email}`);
}

const SESSION_TTL = 7 * 24 * 60 * 60;
const DAILY_LIMIT = 10;

module.exports = {
  parseCookies,
  getSessionToken,
  hashPassword,
  createSalt,
  createToken,
  isTrialExpired,
  getTrialDaysLeft,
  getTodayKey,
  getAuthUser,
  SESSION_TTL,
  DAILY_LIMIT,
};
