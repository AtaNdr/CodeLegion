// GitHub App auth: mint a short-lived JWT signed with the App's private key,
// then exchange for a 1-hour installation access token.
//
// Cached in-process — re-mints when the cached token has <5 min left.

import crypto from 'crypto';
import { normalizePrivateKey } from './pem.js';

let _cached = null;

function base64UrlEncode(input) {
  const b64 = (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signRs256(header, payload, privateKey) {
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  const signature = signer.sign(privateKey);
  return `${headerB64}.${payloadB64}.${base64UrlEncode(signature)}`;
}

export function mintAppJwt() {
  const appId = process.env.GH_APP_ID;
  const privateKey = normalizePrivateKey(process.env.GH_APP_PRIVATE_KEY);
  if (!appId) throw new Error('GH_APP_ID not set');
  if (!privateKey) throw new Error('GH_APP_PRIVATE_KEY not set');
  const now = Math.floor(Date.now() / 1000);
  return signRs256(
    { alg: 'RS256', typ: 'JWT' },
    { iat: now - 60, exp: now + 540, iss: appId },
    privateKey,
  );
}

export async function getInstallationToken({ force = false } = {}) {
  if (!force && _cached && _cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return _cached.token;
  }
  const installationId = process.env.GH_INSTALLATION_ID;
  if (!installationId) throw new Error('GH_INSTALLATION_ID not set');

  const jwt = mintAppJwt();
  const resp = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GitHub access_tokens failed: ${resp.status} ${body}`);
  }
  const data = await resp.json();
  _cached = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
  return data.token;
}

export function clearTokenCache() {
  _cached = null;
}

// Convenience wrapper for authenticated REST calls.
export async function ghFetch(path, options = {}) {
  const token = await getInstallationToken();
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
}

// Mint a JWT and call a path with App auth (not installation auth) — for /app/installations/*.
export async function ghAppFetch(path, options = {}) {
  const jwt = mintAppJwt();
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
}
