// Self-update via the Web App's own management API.
//
// Two paths, in order of preference:
//   1. If the Web App has external git deployment configured (recommended),
//      call webApps.syncRepository() — Azure pulls main and restarts.
//   2. Fallback: just trigger a restart so the user can manually deploy via
//      portal or CLI and have the change take effect.
//
// A full zipdeploy implementation would download a GitHub release tarball,
// repackage as a zip, and POST to the Kudu SCM endpoint. That requires extra
// plumbing (Kudu token, zip building); deferred to a future iteration.

import { appservice } from './clients.js';
import { config } from '../config.js';

// 5-minute cache to avoid hammering the GitHub API on every /api/version
// call (anonymous calls are rate-limited to 60/hour per source IP; behind
// Web App + NAT every page load shares that budget with agent traffic).
let _releaseCache = { at: 0, value: null, error: null };
const RELEASE_TTL_MS = 5 * 60 * 1000;

async function fetchLatestRelease() {
  if (Date.now() - _releaseCache.at < RELEASE_TTL_MS) {
    return { value: _releaseCache.value, error: _releaseCache.error, cached: true };
  }
  const repo = process.env.UPDATE_REPO || 'AtaNdr/CodeLegion';
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub's REST API requires a User-Agent. Without one some endpoints
    // 403 / 404 instead of returning useful data — particularly painful for
    // anonymous calls against private repos, which already 404 for lack of
    // auth.
    'User-Agent': `CodeLegion-Controller/${config.version}`,
  };
  // If the source repo is private (commonly true while a deployment is
  // staged), anonymous calls return 404 and the pill silently never
  // appears. UPDATE_TOKEN — a fine-grained PAT with metadata:read scope
  // on the source repo — fixes that without making the repo public.
  if (process.env.UPDATE_TOKEN) {
    headers.Authorization = `Bearer ${process.env.UPDATE_TOKEN}`;
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const status = r.status;
      const hint = status === 404 && !process.env.UPDATE_TOKEN
        ? 'Source repo may be private. Set UPDATE_TOKEN (a fine-grained GitHub PAT with metadata:read on the source repo) in App Settings to enable update detection.'
        : status === 403
          ? 'GitHub returned 403 — likely rate-limited (60/hour anonymous). Setting UPDATE_TOKEN raises the limit to 5000/hour.'
          : `GitHub returned ${status}.`;
      console.warn(`[self-update] /releases/latest → ${status}: ${text.slice(0, 200)}`);
      _releaseCache = { at: Date.now(), value: null, error: { status, hint } };
      return { value: null, error: _releaseCache.error, cached: false };
    }
    const value = await r.json();
    _releaseCache = { at: Date.now(), value, error: null };
    return { value, error: null, cached: false };
  } catch (e) {
    console.warn('[self-update] fetch failed:', e.message);
    _releaseCache = { at: Date.now(), value: null, error: { status: 0, hint: e.message } };
    return { value: null, error: _releaseCache.error, cached: false };
  }
}

// Parse `vX.Y.Z` (or `X.Y.Z`) into a numeric triplet for comparison.
function parseVersion(s) {
  if (!s) return [0, 0, 0];
  const m = String(s).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function isNewer(latest, current) {
  for (let i = 0; i < 3; i++) {
    if (latest[i] > current[i]) return true;
    if (latest[i] < current[i]) return false;
  }
  return false;
}

export async function getUpdateInfo() {
  const { value: release, error, cached } = await fetchLatestRelease();
  const latestVersion = release?.tag_name || null;
  const hasUpdate = latestVersion
    ? isNewer(parseVersion(latestVersion), parseVersion(config.version))
    : false;
  return {
    currentVersion: config.version,
    latestVersion,
    latestPublishedAt: release?.published_at || null,
    latestHtmlUrl: release?.html_url || null,
    hasUpdate,
    cached,
    error,  // {status, hint} when the GitHub call failed — surfaces in /api/version
  };
}

export function clearUpdateCache() {
  _releaseCache = { at: 0, value: null, error: null };
}

export async function selfUpdate() {
  if (!config.webAppName || !config.resourceGroup) {
    throw new Error('Web App identity not detected');
  }

  let syncedRepo = false;
  try {
    await appservice().webApps.syncRepository(config.resourceGroup, config.webAppName);
    syncedRepo = true;
  } catch (e) {
    console.warn('[self-update] syncRepository failed (no external git configured?):', e.message);
  }

  // Restart so any new code is picked up.
  try {
    await appservice().webApps.restart(config.resourceGroup, config.webAppName);
  } catch (e) {
    throw new Error(`Restart failed: ${e.message}`);
  }

  return {
    ok: true,
    syncedRepo,
    note: syncedRepo
      ? 'External git synced and Web App restarted.'
      : 'Restart triggered. If continuous deployment is not configured, deploy the latest v2 zip manually first.',
  };
}
