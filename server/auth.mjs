import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const cookieName = 'roadmap_session';
const lifetime = 60 * 60 * 24 * 7;
const salt = '96bf457c3e5c2662873b7bb39d8426b4';
const passwordHash = '01aa4054541067ea40b72325df1f1ff6fc56bcf6f03ffd668335a5c9f13daf0a1383210d8f67f2dadc45d1f7a699ab926ec7c92941238352d6455e0378a6b2ed';
const localSecret = randomBytes(48).toString('hex');
const attempts = new Map();
function sign(value) {
  const secret = process.env.ROADMAP_SESSION_SECRET || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!secret && process.env.VERCEL) throw new Error('Session secret is not configured');
  return createHmac('sha256', secret || localSecret).update(value).digest('hex');
}
function equal(a, b) {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
export function authenticated(headers) {
  const cookie = String(headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
  if (!cookie) return false;
  const token = cookie.slice(cookieName.length + 1);
  const [expiry, nonce, signature, extra] = token.split('.');
  if (extra !== undefined || !/^\d+$/.test(expiry || '') || !/^[a-f0-9]{32}$/.test(nonce || '') || !signature) return false;
  const remaining = Number(expiry) - Math.floor(Date.now() / 1000);
  return remaining > 0 && remaining <= lifetime && equal(signature, sign(`${expiry}.${nonce}`));
}
function cookie(value, age) {
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export async function loginHandler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method === 'GET') {
    response.status(200).json({ authenticated: authenticated(request.headers) }); return;
  }
  // Require JSON for mutations so cross-origin HTML forms cannot create or clear sessions.
  if (!['POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE'); response.status(405).json({ error: 'Method not allowed' }); return;
  }
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    response.status(415).json({ error: 'Expected application/json' }); return;
  }
  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', cookie('', 0)); response.status(200).json({ authenticated: false }); return;
  }
  const address = String(request.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const attempt = attempts.get(address) || { count: 0, until: now + 60_000 };
  if (attempt.count >= 10) {
    response.setHeader('Retry-After', String(Math.ceil((attempt.until - now) / 1000)));
    response.status(429).json({ error: 'Too many attempts' }); return;
  }
  let body;
  try { body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; } catch { body = null; }
  const password = body?.password;
  if (typeof password !== 'string' || password.length > 256 || !equal(scryptSync(password, salt, 64).toString('hex'), passwordHash)) {
    attempt.count++; attempts.set(address, attempt);
    response.status(401).json({ error: 'Incorrect password' }); return;
  }
  attempts.delete(address);
  const value = `${Math.floor(now / 1000) + lifetime}.${randomBytes(16).toString('hex')}`;
  response.setHeader('Set-Cookie', cookie(`${value}.${sign(value)}`, lifetime));
  response.status(200).json({ authenticated: true });
}
