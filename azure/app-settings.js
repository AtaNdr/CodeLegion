// Read / merge / write the Web App's own App Settings.
//
// updateApplicationSettings is a REPLACE operation, so we always READ first,
// then MERGE the new keys, then WRITE. This avoids accidentally clearing
// Easy Auth or other settings the user has manually configured.

import { appservice } from './clients.js';
import { config } from '../config.js';

async function readCurrent() {
  if (!config.webAppName || !config.resourceGroup) {
    throw new Error('Web App identity not detected (WEBSITE_SITE_NAME / WEBSITE_RESOURCE_GROUP)');
  }
  const resp = await appservice().webApps.listApplicationSettings(config.resourceGroup, config.webAppName);
  return resp.properties || {};
}

async function writeAll(properties) {
  return appservice().webApps.updateApplicationSettings(
    config.resourceGroup,
    config.webAppName,
    { properties },
  );
}

export async function getAppSettings() {
  return readCurrent();
}

export async function getAppSetting(key) {
  const all = await readCurrent();
  return all[key] ?? null;
}

export async function setAppSettings(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('patch must be an object');
  const current = await readCurrent();
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) delete current[k];
    else current[k] = String(v);
  }
  await writeAll(current);
  // Note: changes take effect after a restart, which Azure does automatically.
  return Object.keys(patch);
}

export async function unsetAppSettings(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const current = await readCurrent();
  for (const k of keys) delete current[k];
  await writeAll(current);
  return keys;
}
