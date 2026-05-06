import { kv } from '@vercel/kv';
import crypto from 'crypto';

export function parseCookies(req) {
  const list = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(c => {
    const parts = c.trim().split('=');
    const key = parts.shift().trim();
    if (key) list[key] = parts.join('=');
  });
  return list;
}

export function getSessionToken(req) {
  return parseCookies(req).formiq_session;
}

export function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function createSalt() {
  return crypto.randomBytes(16).toString('hex');
}

export function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function isTrialExpired(user) {
  if (user.plan !== 'free') return false;
  const expiry = new Date(user.registeredAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  return Date.now() > expiry;
}

export function getTrialDaysLeft(user) {
  const expiry = new Date(user.registeredAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

export async function getAuthUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const email = await kv.get(`session:${token}`);
  if (!email) return null;
  return kv.get(`user:${email}`);
}

export const SESSION_TTL = 7 * 24 * 60 * 60; // seconds
export const DAILY_LIMIT = 10;
