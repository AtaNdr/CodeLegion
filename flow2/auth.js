// Dashboard authentication — password hash in App Settings, signed cookie.
//
// Trust model:
//   - `DASHBOARD_PASSWORD_HASH` App Setting holds a scrypt hash of the
//     password the operator chose. Format: `scrypt:saltHex:hashHex`.
//   - Login posts the plaintext to /login; server scrypt-derives and
//     timing-safe-compares. On success, issues a signed session cookie.
//   - Session cookie = `payload.signature` where payload is base64url of
//     {u, exp} and signature is HMAC-SHA256(REPORT_TOKEN, payload).
//   - Middleware verifies the signature + expiry on every request. No
//     server-side session store — the cookie IS the session.
//
// If `DASHBOARD_PASSWORD_HASH` is unset, the middleware lets everything
// through. That preserves the legacy "open dashboard" behaviour for
// existing private deployments; new public deployers set the env var
// (or use the "Set dashboard password" button) to gate access.

import crypto from 'crypto';

const SCRYPT_PARAMS = { N: 1 << 14, r: 8, p: 1, keyLen: 32 };
const COOKIE_NAME = 'cl_session';
const SESSION_TTL_SECONDS = 24 * 60 * 60;  // 24h

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from((str + pad).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hmacKey() {
  // Reuse REPORT_TOKEN as the cookie HMAC key. Both are controller secrets
  // already; if REPORT_TOKEN rotates, sessions invalidate, which is the
  // desired behaviour (re-login).
  return process.env.REPORT_TOKEN || '';
}

export function isAuthConfigured() {
  return !!(process.env.DASHBOARD_PASSWORD_HASH && process.env.DASHBOARD_PASSWORD_HASH.startsWith('scrypt:'));
}

export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_PARAMS.keyLen, SCRYPT_PARAMS);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const [, saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  let salt, expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch { return false; }
  const got = crypto.scryptSync(plain, salt, expected.length, SCRYPT_PARAMS);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export function issueSession() {
  const key = hmacKey();
  if (!key) throw new Error('cannot issue session: REPORT_TOKEN not set');
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = b64urlEncode(JSON.stringify({ u: 'admin', exp }));
  const sig = b64urlEncode(crypto.createHmac('sha256', key).update(payload).digest());
  return { value: `${payload}.${sig}`, maxAge: SESSION_TTL_SECONDS };
}

function verifySession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const key = hmacKey();
  if (!key) return null;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return null;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = b64urlEncode(crypto.createHmac('sha256', key).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(payload).toString('utf8'));
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch { return null; }
}

function parseCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const ALLOW_UNAUTHED = new Set(['/health', '/login', '/logout', '/webhook']);
function isPublicPath(path) {
  if (ALLOW_UNAUTHED.has(path)) return true;
  return path.startsWith('/agent/') || path.startsWith('/scripts/');
}

export function requireDashboardAuth(req, res, next) {
  if (isPublicPath(req.path)) return next();
  if (!isAuthConfigured()) return next();  // legacy open-dashboard mode
  const session = verifySession(parseCookie(req.headers.cookie, COOKIE_NAME));
  if (session) { req.session = session; return next(); }
  const accepts = req.headers.accept || '';
  if (accepts.includes('text/html')) {
    return res.redirect('/login?return=' + encodeURIComponent(req.originalUrl || '/'));
  }
  return res.status(401).json({ error: 'unauthorized — please log in via /login' });
}

export function setSessionCookie(res) {
  const { value, maxAge } = issueSession();
  // Secure flag is set because App Service serves https. SameSite=Lax so
  // navigations from the GitHub release link still send the cookie.
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
