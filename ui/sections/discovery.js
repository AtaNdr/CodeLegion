// Resource-group discovery card. Useful diagnostic; appears below Flow 1.

import { escapeHtml } from '../common.js';
import { config } from '../../config.js';

export function renderDiscovery({ discovery, missing, topError, setupInline = '' }) {
  const { rg, network: net, netError } = discovery;
  const subDisplay = config.subscriptionId
    ? `<code>${escapeHtml(config.subscriptionId)}</code>`
    : '<span class="err">NOT SET</span>';
  const rgDisplay = rg
    ? `<code>${escapeHtml(rg.name)}</code>${rg.location ? ` in <code>${escapeHtml(rg.location)}</code>` : ''}${rg.error ? ` <span class="err">(${escapeHtml(rg.error)})</span>` : ''}`
    : '<em class="muted">not discovered</em>';
  const vnets = net?.vnets || [];
  const nsgs = net?.nsgs || [];
  const nats = net?.natGateways || [];

  return `
<details>
  <summary><h2 style="display:inline-block; margin:0">Environment & discovery</h2></summary>

  <div class="card spread" style="margin-top:.5rem">
    <span class="muted" style="font-size:.88rem">Infrastructure maintenance — sweeps failed VMs, orphan NICs (which hold subnet IPs), and orphan disks (which accrue cost). Run if VM spin-up fails with "subnet does not have enough capacity" or to reclaim leaked disks.</span>
    <button onclick="doCleanupOrphans()">Cleanup orphan resources</button>
  </div>

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

  ${netError ? `<div class="card err"><strong>Network discovery failed:</strong> ${escapeHtml(netError)}</div>` : ''}
  <div class="grid">
    <div class="card">
      <h3>Virtual networks (${vnets.length})</h3>
      ${vnets.length === 0
        ? '<p class="empty">None found.</p>'
        : vnets.map(v => `
            <p style="margin:.25rem 0"><code>${escapeHtml(v.name)}</code> · ${(v.addressSpace || []).map(escapeHtml).join(', ') || '?'}</p>
            ${v.subnets?.length
              ? `<ul>${v.subnets.map(s => `<li><code>${escapeHtml(s.name)}</code> ${escapeHtml(s.addressPrefix || '')}${s.nsg ? ' <span class="muted">· NSG</span>' : ''}${s.natGateway ? ' <span class="muted">· NAT</span>' : ''}</li>`).join('')}</ul>`
              : '<p class="empty muted" style="margin:.25rem 0">No subnets.</p>'}
          `).join('')}
    </div>
    <div class="card">
      <h3>Network security groups (${nsgs.length})</h3>
      ${nsgs.length === 0
        ? '<p class="empty">None found.</p>'
        : '<ul>' + nsgs.map(n => `<li><code>${escapeHtml(n.name)}</code></li>`).join('') + '</ul>'}
    </div>
    <div class="card">
      <h3>NAT gateways (${nats.length})</h3>
      ${nats.length === 0
        ? '<p class="empty">None found.</p>'
        : '<ul>' + nats.map(n => `<li><code>${escapeHtml(n.name)}</code></li>`).join('') + '</ul>'}
    </div>
  </div>

  ${setupInline ? `<div style="margin-top:1rem">${setupInline}</div>` : ''}
</details>`;
}
