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

async function fetchLatestRelease() {
  const repo = process.env.UPDATE_REPO || 'AtaNdr/CodeLegion';
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export async function getUpdateInfo() {
  const release = await fetchLatestRelease();
  return {
    currentVersion: config.version,
    latestVersion: release?.tag_name || null,
    latestPublishedAt: release?.published_at || null,
    latestHtmlUrl: release?.html_url || null,
    hasUpdate: release && release.tag_name && release.tag_name !== `v${config.version}`,
  };
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
