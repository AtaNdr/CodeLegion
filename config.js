// CodeLegion config — read env vars, apply defaults.
//
// The user's only required deploy-time setting is AZURE_SUBSCRIPTION_ID.
// Everything else is either auto-detected from the App Service environment
// (WEBSITE_RESOURCE_GROUP, WEBSITE_SITE_NAME, WEBSITE_HOSTNAME) or filled in
// by Flow 1 after the user walks the setup wizard.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),

  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || null,
  resourceGroup: process.env.AZURE_RESOURCE_GROUP || process.env.WEBSITE_RESOURCE_GROUP || null,

  webAppName: process.env.WEBSITE_SITE_NAME || null,
  publicHostname: process.env.WEBSITE_HOSTNAME || null,

  dataDir: process.env.DATA_DIR || '/home/data',

  // Single source of truth: package.json. Bump there, version follows everywhere.
  version: readPkgVersion(),
  // Optional commit/build metadata, set by CI on release builds.
  commit: process.env.CODELEGION_COMMIT || null,
  buildDate: process.env.CODELEGION_BUILD_DATE || null,
};

export function missingRequiredConfig() {
  const missing = [];
  if (!config.subscriptionId) missing.push('AZURE_SUBSCRIPTION_ID');
  if (!config.resourceGroup) missing.push('WEBSITE_RESOURCE_GROUP (or AZURE_RESOURCE_GROUP)');
  return missing;
}
