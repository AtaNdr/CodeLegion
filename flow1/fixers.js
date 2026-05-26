// Remediation actions per Check id. Each returns {status, detail} after running.
// Wired into POST /setup/action/:id by flow1/actions.js.

import crypto from 'crypto';
import { config } from '../config.js';
import { provisionNetwork, resourceNames } from '../azure/provision.js';
import { setAppSettings } from '../azure/app-settings.js';
import { injectFiles, syncLabels, setBranchProtection } from '../github/repo.js';

const generateSecret = () => crypto.randomBytes(32).toString('hex');

async function ensureBaseAppSettings() {
  // Settings we can derive from the runtime environment without user input.
  const patch = {
    CONTROLLER_PUBLIC_URL: `https://${config.publicHostname}`,
    AGENT_SCRIPTS_URL: `https://${config.publicHostname}/scripts/agent-scripts.tar.gz`,
  };
  if (!process.env.REPORT_TOKEN) patch.REPORT_TOKEN = generateSecret();
  if (!process.env.GH_WEBHOOK_SECRET) patch.GH_WEBHOOK_SECRET = generateSecret();
  await setAppSettings(patch);
  return patch;
}

export const fixers = {
  async network() {
    const result = await provisionNetwork();
    await setAppSettings({
      AZURE_LOCATION: result.location,
      AZURE_VNET_NAME: result.vnet.name,
      AZURE_SUBNET_NAME: result.subnet.name,
      AZURE_NSG_NAME: result.nsg.name,
      AZURE_NAT_NAME: result.nat.name,
      AZURE_PIP_NAME: result.pip.name,
    });
    const verb = result.adopted ? 'adopted existing' : 'created fresh';
    return {
      status: 'green',
      detail: `${verb} vnet=${result.vnet.name} subnet=${result.subnet.name} nsg=${result.nsg.name} nat=${result.nat.name} in ${result.location}`,
    };
  },

  async repoTemplate() {
    const owner = process.env.GH_REPO_OWNER;
    const repo = process.env.GH_REPO_NAME;
    if (!owner || !repo) throw new Error('GH_REPO_OWNER / GH_REPO_NAME not set');
    const results = await injectFiles();
    const created = results.filter(r => r.action === 'created').length;
    const updated = results.filter(r => r.action === 'updated').length;
    const errors = results.filter(r => r.action === 'error');
    if (errors.length) {
      return { status: 'yellow', detail: `created ${created}, updated ${updated}, ${errors.length} errors: ${errors[0].error}` };
    }
    return { status: 'green', detail: `created ${created}, updated ${updated}, ${results.length - created - updated} unchanged` };
  },

  async labels() {
    const out = await syncLabels();
    const created = out.filter(o => o.action === 'created').length;
    const errors = out.filter(o => o.action?.startsWith('error'));
    if (errors.length) return { status: 'yellow', detail: `created ${created}, ${errors.length} errors` };
    return { status: 'green', detail: `created ${created}, ${out.length - created} already present` };
  },

  async branchProtection() {
    await setBranchProtection('main');
    return { status: 'green', detail: 'main protected (1 review + CODEOWNERS)' };
  },

  async anthropic() {
    // No fix without a key — UI directs user to "Upload key" instead.
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('No key to validate. Click "Upload key" to provide one.');
    }
    // Re-running the check is the fix here.
    return { status: 'green', detail: 'use Run to validate; nothing to provision' };
  },

  async githubApp() {
    if (!process.env.GH_APP_PRIVATE_KEY) {
      throw new Error('No PEM. Click "Upload PEM" to provide one.');
    }
    // Same as anthropic — running the check IS the validation.
    return { status: 'green', detail: 'use Run to validate; nothing to provision' };
  },
};

export { ensureBaseAppSettings };
