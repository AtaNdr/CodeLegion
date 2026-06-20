// Resource-group discovery card. Useful diagnostic; appears below Flow 1.

import { escapeHtml } from '../common.js';
import { config } from '../../config.js';

// Friendly short labels for the resource-count card. Anything not in this
// map is shown by its raw Microsoft.* type — easier to spot oddities.
const RESOURCE_LABELS = {
  'Microsoft.Compute/virtualMachines': 'VMs',
  'Microsoft.Compute/disks': 'Disks',
  'Microsoft.Network/networkInterfaces': 'NICs',
  'Microsoft.Network/virtualNetworks': 'VNets',
  'Microsoft.Network/networkSecurityGroups': 'NSGs',
  'Microsoft.Network/publicIPAddresses': 'Public IPs',
  'Microsoft.Network/natGateways': 'NAT gateways',
  'Microsoft.Web/sites': 'Web Apps',
  'Microsoft.Web/serverfarms': 'App Service Plans',
  'Microsoft.KeyVault/vaults': 'Key Vaults',
  'Microsoft.Storage/storageAccounts': 'Storage accounts',
};

export function renderDiscovery({ discovery, missing, topError, setupInline = '' }) {
  const { rg, netError, resourceCounts } = discovery;
  const subDisplay = config.subscriptionId
    ? `<code>${escapeHtml(config.subscriptionId)}</code>`
    : '<span class="err">NOT SET</span>';
  const rgDisplay = rg
    ? `<code>${escapeHtml(rg.name)}</code>${rg.location ? ` in <code>${escapeHtml(rg.location)}</code>` : ''}${rg.error ? ` <span class="err">(${escapeHtml(rg.error)})</span>` : ''}`
    : '<em class="muted">not discovered</em>';

  // Unified resources view — every resource in the RG, grouped by type
  // with names listed inline. Replaces the older split between three
  // typed cards (VNets / NSGs / NATs) and a separate count table.
  const rc = resourceCounts || { total: 0, byType: [] };
  const rcRows = (rc.byType || []).map(({ type, count, items = [] }) => {
    const label = RESOURCE_LABELS[type] || type;
    const known = RESOURCE_LABELS[type] ? '' : ' <span class="muted" style="font-size:.78rem">(other)</span>';
    const names = items.length === 0
      ? '<span class="muted">—</span>'
      : items.map(it => `<div style="font: .85em ui-monospace, monospace; padding: 1px 0">${escapeHtml(it.name || '?')}</div>`).join('');
    return `<tr>
      <td style="white-space:nowrap; vertical-align:top">${escapeHtml(label)}${known}</td>
      <td style="text-align:right; vertical-align:top; font-variant-numeric: tabular-nums; padding-right:1rem">${count}</td>
      <td style="vertical-align:top">${names}</td>
    </tr>`;
  }).join('');
  const resourcesCard = `
    <div class="card" style="margin-top:.5rem">
      <h3>Resources in RG (${rc.total || 0})</h3>
      ${rc.error
        ? `<p class="err">${escapeHtml(rc.error)}</p>`
        : rc.total === 0
          ? '<p class="empty">None found.</p>'
          : `<table>
              <thead><tr>
                <th style="text-align:left">Type</th>
                <th style="text-align:right; padding-right:1rem">Count</th>
                <th style="text-align:left">Names</th>
              </tr></thead>
              <tbody>${rcRows}</tbody>
            </table>`}
      ${netError ? `<p class="err" style="margin-top:.5rem; font-size:.85rem">Network discovery failed: ${escapeHtml(netError)}</p>` : ''}
    </div>`;

  return `
<details open>
  <summary><h2 style="display:inline-block; margin:0">Environment & discovery</h2></summary>

  ${missing.length > 0 ? `
    <div class="card err">
      <strong>Missing required configuration:</strong>
      <ul>${missing.map(m => `<li><code>${escapeHtml(m)}</code></li>`).join('')}</ul>
    </div>` : ''}
  ${topError ? `<div class="card err"><strong>Discovery error:</strong> ${escapeHtml(topError)}</div>` : ''}

  <div class="card">
    <table>
      <tr><th style="width:30%">Subscription</th><td>${subDisplay}</td></tr>
      <tr><th>Resource group</th><td>${rgDisplay}</td></tr>
      <tr><th>Web App</th><td><code>${escapeHtml(config.webAppName || '?')}</code></td></tr>
      <tr><th>Hostname</th><td><code>${escapeHtml(config.publicHostname || '?')}</code></td></tr>
      <tr><th>Data dir</th><td><code>${escapeHtml(config.dataDir)}</code></td></tr>
    </table>
  </div>

  ${resourcesCard}

  <div class="card spread" style="margin-top:.75rem">
    <span class="muted" style="font-size:.88rem">Infrastructure maintenance — sweeps failed VMs, orphan NICs (which hold subnet IPs), and orphan disks (which accrue cost). Run if VM spin-up fails with "subnet does not have enough capacity" or to reclaim leaked disks.</span>
    <button onclick="doCleanupOrphans()">Cleanup orphan resources</button>
  </div>

  <div class="card spread" style="margin-top:.5rem; border-color: var(--err)">
    <span class="muted" style="font-size:.88rem">Tear down CodeLegion — remove the CodeLegion files from the repo, wipe every Azure resource in the RG (except this Web App and its plan), or both. The fleet is paused first; you can re-install by re-running Infrastructure setup.</span>
    <button class="danger" onclick="showUninstallModal()">Uninstall…</button>
  </div>

  ${setupInline ? `<div style="margin-top:1rem">${setupInline}</div>` : ''}
</details>`;
}
