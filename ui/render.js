// Top-level HTML page renderer. Composes sections.

import { config } from '../config.js';
import { escapeHtml, STYLES } from './common.js';
import { renderSetup } from './sections/setup.js';
import { renderDiscovery } from './sections/discovery.js';
import { INLINE_SCRIPT } from './script.js';

export function renderPage({ phase1, discovery, missing, topError, fleet, cost, version, adminToken }) {
  // Once Flow 1 is fully green, fold the setup section into Environment &
  // discovery so the dashboard's primary content is the fleet, not a
  // permanent green checklist that no longer needs attention. If anything
  // regresses (a check goes yellow/red), it pops back to the top.
  // When inline (folded into Environment), the setup <details> defaults
  // closed and doesn't persist, so clicking Environment doesn't auto-expand
  // setup. When at top (allDone=false), persist + default-open as before.
  const setupAtTop = phase1 && !phase1.summary?.allDone ? renderSetup(phase1) : '';
  const setupInDiscovery = phase1 && phase1.summary?.allDone ? renderSetup(phase1, { inline: true }) : '';
  const discoverySection = discovery ? renderDiscovery({ discovery, missing, topError, setupInline: setupInDiscovery }) : '';
  const fleetSection = fleet || '';
  const costSection = cost || '';
  // Admin endpoints (/admin/*) require an X-Admin-Token header that matches
  // REPORT_TOKEN. We render it into the page so the dashboard JS can attach
  // it to admin requests. Same trust boundary as the webhook secret already
  // shown in the Configure App modal — anyone who can load /status can see
  // both. Enable App Service Easy Auth to gate /status access if needed.
  const tokenMeta = adminToken
    ? `<meta name="codelegion-admin-token" content="${escapeHtml(adminToken)}">`
    : '';

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>CodeLegion</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${tokenMeta}
  <!-- Auto-refresh handled in JS so we can skip while a modal is open. -->

  <style>${STYLES}</style>
</head><body>
<main>
  <h1>CodeLegion</h1>
  ${setupAtTop}
  <div id="fleet-container">${fleetSection}</div>
  ${costSection}
  ${discoverySection}
  <footer>
    <div id="version-line" style="margin-bottom:.25rem">v${escapeHtml(version || config.version)}</div>
    <a href="/api/version">/api/version</a> ·
    <a href="/api/state">/api/state</a> ·
    <a href="/setup">/setup</a> ·
    <a href="/fleet">/fleet</a> ·
    <a href="/cost/summary">/cost/summary</a> ·
    <a href="/api/discovery">/api/discovery</a> ·
    <a href="/health">/health</a>
  </footer>

  <dialog id="timeline-modal">
    <div class="spread"><h3 id="timeline-title" style="margin:0">Timeline</h3>
      <button onclick="document.getElementById('timeline-modal').close()">Close</button></div>
    <pre id="timeline-body" style="font: .8rem ui-monospace, monospace; max-height: 60vh; overflow:auto; margin-top:.5rem"></pre>
  </dialog>

  <dialog id="confirm-modal" style="max-width: 420px">
    <h3 id="confirm-title" style="margin-top:0">Confirm</h3>
    <p id="confirm-body" class="muted" style="margin:.5rem 0 1rem 0">Are you sure?</p>
    <div class="row" style="justify-content:flex-end; gap:.5rem">
      <button type="button" onclick="resolveConfirm(false)">Cancel</button>
      <button type="button" id="confirm-ok-btn" class="primary" onclick="resolveConfirm(true)">Confirm</button>
    </div>
  </dialog>

  <dialog id="vm-config-modal" style="max-width: 460px">
    <form onsubmit="submitVmConfig(event); return false;">
      <h2 style="margin-top:0">VM sizes per model</h2>
      <p class="muted" style="margin:.25rem 0 .75rem 0">Override the default Azure VM size used when spinning each model's agent. Saves to <code>VM_SIZE_HAIKU</code> / <code>VM_SIZE_SONNET</code> / <code>VM_SIZE_OPUS</code> App Settings. Existing running agents keep their current size; the change applies to the next spin.</p>
      <div style="display:grid; gap:.5rem">
        <div>
          <label for="vm-size-haiku" style="display:block; font-size:.85rem; color:var(--muted)">haiku</label>
          <input id="vm-size-haiku" type="text" placeholder="Standard_D2as_v4" autocomplete="off">
        </div>
        <div>
          <label for="vm-size-sonnet" style="display:block; font-size:.85rem; color:var(--muted)">sonnet</label>
          <input id="vm-size-sonnet" type="text" placeholder="Standard_D2as_v4" autocomplete="off">
        </div>
        <div>
          <label for="vm-size-opus" style="display:block; font-size:.85rem; color:var(--muted)">opus</label>
          <input id="vm-size-opus" type="text" placeholder="Standard_D4as_v4" autocomplete="off">
        </div>
      </div>
      <p class="muted" style="font-size:.8rem; margin-top:.5rem">Leave a field blank to keep its current value. Common sizes: <code>Standard_D2as_v4</code>, <code>Standard_D4as_v4</code>, <code>Standard_D8as_v4</code>.</p>
      <div class="row" style="justify-content:flex-end; gap:.5rem; margin-top:.75rem">
        <button type="button" onclick="document.getElementById('vm-config-modal').close()">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  </dialog>

  <dialog id="pricing-modal" style="max-width: 720px">
    <form onsubmit="submitPricing(event); return false;">
      <h2 style="margin-top:0">Anthropic pricing</h2>
      <p class="muted" style="margin:.25rem 0 .5rem 0">Edit per-model rates in <strong>$ per million tokens</strong>. Saves to the <code>PRICING_JSON</code> App Setting. Used immediately for cost calculations.</p>
      <div style="overflow-x:auto">
        <table style="width:100%">
          <thead><tr>
            <th style="text-align:left">Model</th>
            <th style="text-align:right">Input</th>
            <th style="text-align:right">Output</th>
            <th style="text-align:right">Cache read</th>
            <th style="text-align:right">Cache write (5m)</th>
            <th></th>
          </tr></thead>
          <tbody id="pricing-rows"></tbody>
        </table>
      </div>
      <div class="row" style="margin-top:.5rem">
        <button type="button" onclick="addPricingRow()">+ Add model</button>
        <span class="muted" style="font-size:.82rem; margin-left:.5rem">Model name matches the <code>model:</code> label on issues (e.g. <code>haiku</code>, <code>sonnet</code>, <code>opus</code>).</span>
      </div>
      <div class="row" style="justify-content:space-between; gap:.5rem; margin-top:.75rem">
        <button type="button" class="danger" onclick="clearPricing()">Clear override (revert to bundled)</button>
        <div class="row" style="gap:.5rem">
          <button type="button" onclick="document.getElementById('pricing-modal').close()">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </div>
    </form>
  </dialog>

  <dialog id="uninstall-modal" style="max-width: 520px">
    <form onsubmit="submitUninstall(event); return false;">
      <h2 style="margin-top:0">Uninstall CodeLegion</h2>
      <p class="muted" style="margin:.25rem 0 .75rem 0">Pick what to remove. <strong>This cannot be undone.</strong> The fleet is paused first.</p>

      <div style="display:grid; gap:.4rem; padding:.5rem; border:1px solid var(--border); border-radius:4px">
        <label style="display:flex; gap:.5rem; align-items:flex-start; padding:.35rem; cursor:pointer">
          <input type="radio" name="scope" value="repo" required style="margin-top:.2rem">
          <div>
            <div><strong>Clean repo files</strong></div>
            <div class="muted" style="font-size:.85rem">Removes agent-fleet templates from your GitHub repo (CLAUDE.md, DO_NOT_TOUCH.md, ISSUE_TEMPLATEs, …). Issues, PRs, and your own code untouched.</div>
          </div>
        </label>
        <label style="display:flex; gap:.5rem; align-items:flex-start; padding:.35rem; cursor:pointer">
          <input type="radio" name="scope" value="azure" style="margin-top:.2rem">
          <div>
            <div><strong>Clean Azure resources</strong></div>
            <div class="muted" style="font-size:.85rem">Deletes every resource in the RG except this Web App and its App Service Plan: VMs, disks, NICs, VNet, NSG, NAT, public IP.</div>
          </div>
        </label>
        <label style="display:flex; gap:.5rem; align-items:flex-start; padding:.35rem; cursor:pointer">
          <input type="radio" name="scope" value="both" style="margin-top:.2rem">
          <div>
            <div><strong>Both</strong></div>
            <div class="muted" style="font-size:.85rem">Repo files AND Azure infra. Controller stays up; App Settings preserved so you can re-install via Flow 1.</div>
          </div>
        </label>
      </div>

      <div style="margin-top:.75rem">
        <label for="uninstall-confirm-text" style="display:block; font-size:.85rem; color:var(--muted)">
          Type <code>UNINSTALL</code> to confirm
        </label>
        <input id="uninstall-confirm-text" type="text" required autocomplete="off" placeholder="UNINSTALL" style="margin-top:.2rem">
      </div>

      <div class="row" style="justify-content:flex-end; gap:.5rem; margin-top:.75rem">
        <button type="button" onclick="document.getElementById('uninstall-modal').close()">Cancel</button>
        <button type="submit" class="danger">Uninstall</button>
      </div>
    </form>
  </dialog>
</main>
<script>${INLINE_SCRIPT}</script>
</body></html>`;
}
