// Flow 1 — Infrastructure checks.
//
// Each Check has: { id, label, category, run() → {status, detail, fixable?, remediation?} }.
// Phase 2 surface = read-only (run() only). Phase 3 adds fix() per check.
//
// Status values: green | yellow | red | unknown.

import { config } from '../config.js';
import { discoverResourceGroup, discoverNetwork } from '../azure/discovery.js';
import { checkInstallation, listInstallationRepos } from '../github/install-check.js';
import { getRepoFile, REQUIRED_LABELS, getBranchProtection } from '../github/repo.js';
import { ghFetch } from '../github/app.js';

export const checks = [
  {
    id: 'subscription',
    label: 'Subscription accessible',
    category: 'azure',
    async run() {
      if (!config.subscriptionId) {
        return { status: 'red', detail: 'AZURE_SUBSCRIPTION_ID not set in App Settings.' };
      }
      return { status: 'green', detail: config.subscriptionId };
    },
  },
  {
    id: 'resourceGroup',
    label: 'Resource group',
    category: 'azure',
    async run() {
      if (!config.resourceGroup) {
        return { status: 'red', detail: 'No resource group detected. Set WEBSITE_RESOURCE_GROUP.' };
      }
      const rg = await discoverResourceGroup();
      if (!rg) return { status: 'red', detail: 'Discovery returned null.' };
      if (rg.error) return { status: 'red', detail: rg.error };
      return { status: 'green', detail: `${rg.name} in ${rg.location || '?'}` };
    },
  },
  {
    id: 'network',
    label: 'Network (vnet · agents subnet · NSG · NAT)',
    category: 'azure',
    fixable: true,
    async run() {
      let net;
      try { net = await discoverNetwork(); }
      catch (e) { return { status: 'red', detail: e.message, fixable: true }; }

      const vnet = net.vnets[0];
      if (!vnet) {
        return {
          status: 'red',
          detail: 'No VNet in the resource group. The Web App needs VNet integration + NAT for outbound internet — set it up first, then click Fix to add the agents subnet.',
          fixable: true,
        };
      }

      const agentsSubnet = vnet.subnets?.find(s => s.name === 'agents');
      if (!agentsSubnet) {
        return {
          status: 'yellow',
          detail: `VNet ${vnet.name} present; agents subnet missing. Click Fix to add it.`,
          fixable: true,
        };
      }

      const hasNsg = !!agentsSubnet.nsg;
      const hasNat = !!agentsSubnet.natGateway;
      if (!hasNsg || !hasNat) {
        return {
          status: 'yellow',
          detail: `agents subnet on ${vnet.name}: NSG=${hasNsg ? 'yes' : 'NO'} NAT=${hasNat ? 'yes' : 'NO'}`,
          fixable: true,
        };
      }

      const natCount = net.natGateways.length;
      return {
        status: 'green',
        detail: `vnet=${vnet.name} agents subnet ${agentsSubnet.addressPrefix} with NSG + NAT (${natCount} gateway${natCount === 1 ? '' : 's'} in RG)`,
      };
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic key valid',
    category: 'anthropic',
    fixable: true,
    async run() {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) {
        return {
          status: 'red',
          detail: 'ANTHROPIC_API_KEY not set in App Settings.',
          fixable: true,
          remediation: 'Click "Upload key" to provide one.',
        };
      }
      // Direct fetch to /v1/models — keeps us off any specific SDK version.
      try {
        const resp = await fetch('https://api.anthropic.com/v1/models?limit=1', {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
        });
        if (resp.status === 401) {
          return { status: 'red', detail: 'Key rejected (401 Unauthorized).', fixable: true };
        }
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          return { status: 'red', detail: `${resp.status} ${resp.statusText} ${text.slice(0, 120)}`, fixable: true };
        }
        const data = await resp.json();
        const sample = data?.data?.[0]?.id || 'unknown';
        return { status: 'green', detail: `key valid · saw ${sample}` };
      } catch (e) {
        return { status: 'red', detail: e.message || String(e), fixable: true };
      }
    },
  },
  {
    id: 'githubApp',
    label: 'GitHub App + repo access',
    category: 'github',
    fixable: true,
    async run() {
      // 1. All five App Settings must be present.
      const missing = [];
      if (!process.env.GH_APP_ID) missing.push('GH_APP_ID');
      if (!process.env.GH_INSTALLATION_ID) missing.push('GH_INSTALLATION_ID');
      if (!process.env.GH_APP_PRIVATE_KEY) missing.push('GH_APP_PRIVATE_KEY');
      if (!process.env.GH_REPO_OWNER) missing.push('GH_REPO_OWNER');
      if (!process.env.GH_REPO_NAME) missing.push('GH_REPO_NAME');
      if (missing.length) {
        return {
          status: 'red',
          detail: `App Settings missing: ${missing.join(', ')}`,
          fixable: true,
          remediation: 'Click "Configure App" to provide them.',
        };
      }

      // 2. Installation exists (mints JWT + GET /app/installations/{id}).
      let install;
      try {
        install = await checkInstallation();
      } catch (e) {
        return { status: 'red', detail: `App credentials invalid: ${e.message}`, fixable: true };
      }

      // 3. Target repo is in the installation's repo list.
      const owner = process.env.GH_REPO_OWNER;
      const repo = process.env.GH_REPO_NAME;
      try {
        const repos = await listInstallationRepos();
        const fullName = `${owner}/${repo}`.toLowerCase();
        const hit = repos.find(r => (r.full_name || '').toLowerCase() === fullName);
        if (hit) {
          return {
            status: 'green',
            detail: `App ${install.app_slug || install.app_id} on ${install.account?.login || '?'} · ${owner}/${repo} accessible (private=${hit.private})`,
          };
        }
        const sample = repos.slice(0, 3).map(r => r.full_name).join(', ');
        return {
          status: 'red',
          detail: `${owner}/${repo} not in installation (${repos.length} repo${repos.length === 1 ? '' : 's'} available${sample ? ': ' + sample : ''})`,
          fixable: true,
          remediation: 'Install the GitHub App on this repo, or fix the owner/repo via "Configure App".',
        };
      } catch (e) {
        return { status: 'red', detail: e.message };
      }
    },
  },
  {
    id: 'repoTemplate',
    label: 'Repo template installed',
    category: 'github',
    fixable: true,
    async run() {
      try {
        const claude = await getRepoFile('CLAUDE.md');
        if (!claude) return { status: 'red', detail: 'CLAUDE.md not found in target repo. Click Fix to inject the template.', fixable: true };
        // Spot-check a couple of contract files.
        const designDefaults = await getRepoFile('DESIGN_DEFAULTS.md');
        const labels = await getRepoFile('.github/labels.yml');
        const missing = [];
        if (!designDefaults) missing.push('DESIGN_DEFAULTS.md');
        if (!labels) missing.push('.github/labels.yml');
        if (missing.length) {
          return { status: 'yellow', detail: `partial: missing ${missing.join(', ')}`, fixable: true };
        }
        return { status: 'green', detail: `template files present` };
      } catch (e) {
        return { status: 'red', detail: e.message };
      }
    },
  },
  {
    id: 'labels',
    label: 'GitHub labels',
    category: 'github',
    fixable: true,
    async run() {
      const owner = process.env.GH_REPO_OWNER;
      const repo = process.env.GH_REPO_NAME;
      if (!owner || !repo) return { status: 'red', detail: 'Repo not configured.' };
      try {
        const resp = await ghFetch(`/repos/${owner}/${repo}/labels?per_page=100`);
        if (!resp.ok) return { status: 'red', detail: `GET labels: ${resp.status}` };
        const present = new Set((await resp.json()).map(l => l.name));
        const missing = REQUIRED_LABELS.filter(l => !present.has(l.name)).map(l => l.name);
        if (missing.length === 0) return { status: 'green', detail: `${REQUIRED_LABELS.length} labels present` };
        return { status: 'yellow', detail: `missing ${missing.length}: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`, fixable: true };
      } catch (e) {
        return { status: 'red', detail: e.message };
      }
    },
  },
  {
    id: 'branchProtection',
    label: 'Branch protection (main)',
    category: 'github',
    fixable: true,
    async run() {
      try {
        const prot = await getBranchProtection('main');
        if (!prot) return { status: 'yellow', detail: 'No branch protection on main.', fixable: true };
        const codeOwners = !!prot.required_pull_request_reviews?.require_code_owner_reviews;
        const reviews = prot.required_pull_request_reviews?.required_approving_review_count || 0;
        if (codeOwners && reviews >= 1) return { status: 'green', detail: `${reviews} review(s), CODEOWNERS enforced` };
        return { status: 'yellow', detail: `protection weak: reviews=${reviews} codeowners=${codeOwners}`, fixable: true };
      } catch (e) {
        if (e.code === 'GH_APP_MISSING_ADMIN') {
          return { status: 'yellow', detail: 'Cannot read branch protection.', fixable: true, remediation: e.message };
        }
        if (/Branch not protected/i.test(e.message)) return { status: 'yellow', detail: 'No branch protection.', fixable: true };
        return { status: 'red', detail: e.message };
      }
    },
  },
];

export function checkById(id) {
  return checks.find(c => c.id === id);
}
