// Top-level HTML page renderer. Composes sections.

import { config } from '../config.js';
import { escapeHtml, STYLES } from './common.js';
import { renderSetup } from './sections/setup.js';
import { renderDiscovery } from './sections/discovery.js';
import { computeNotifications, renderNotificationsPanel } from './sections/notifications.js';
import { INLINE_SCRIPT } from './script.js';

export function renderPage({ phase1, discovery, missing, topError, fleet, fleetData, cost, version, adminToken }) {
  // Header-icon model:
  //   - The main page is fleet + cost only.
  //   - Setup + Environment & discovery live behind the ⚙ gear icon's
  //     right-side Settings drawer.
  //   - Setup bubbles up to the main page only when not yet allDone — a
  //     fresh deploy shouldn't make an operator hunt for the wizard.
  //   - The gear icon shows a red badge in that case.
  const setupAtTop = phase1 && !phase1.summary?.allDone ? renderSetup(phase1) : '';
  const setupForDrawer = phase1 ? renderSetup(phase1, { inline: true }) : '';
  const discoveryForDrawer = discovery ? renderDiscovery({ discovery, missing, topError, setupInline: '' }) : '';

  const setupNeedsAttention = phase1?.summary && !phase1.summary.allDone;
  const settingsBadge = setupNeedsAttention
    ? `<span class="icon-badge" title="Setup incomplete">${phase1.summary.red || 0}</span>`
    : '';

  // Notifications — computed server-side from data the page already has.
  // The client adds 'update-available' dynamically after /api/version.
  const notifications = computeNotifications({ phase1, fleet: fleetData });
  const notificationsPanel = renderNotificationsPanel(notifications);
  const notifBadge = notifications.length > 0
    ? `<span class="icon-badge">${notifications.length}</span>`
    : '';

  const fleetSection = fleet || '';
  const costSection = cost || '';

  // Admin token is rendered into the page so the inline JS can attach it
  // to /admin/* requests. Enable App Service Easy Auth to gate /status.
  const tokenMeta = adminToken
    ? `<meta name="codelegion-admin-token" content="${escapeHtml(adminToken)}">`
    : '';
  const o = process.env.GH_REPO_OWNER, r = process.env.GH_REPO_NAME;
  const repoMeta = o && r
    ? `<meta name="codelegion-repo" content="${escapeHtml(o + '/' + r)}">`
    : '';

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>CodeLegion</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${tokenMeta}
  ${repoMeta}
  <style>${STYLES}</style>
</head><body>

<header class="app-header">
  <div class="app-header-inner">
    <div class="brand-block">
      <span class="brand-mark" aria-hidden="true">CL</span>
      <span class="brand-name">CodeLegion</span>
      <span class="brand-version">v${escapeHtml(version || config.version)}</span>
    </div>
    <div class="header-icons">
      <button type="button" class="icon-btn" id="themeIconBtn" aria-label="Toggle light/dark theme" title="Toggle light/dark">
        <svg class="theme-sun" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
        <svg class="theme-moon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
      <button type="button" class="icon-btn" id="notifIconBtn" aria-label="Notifications" aria-haspopup="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        ${notifBadge}
      </button>
      <button type="button" class="icon-btn" id="settingsIconBtn" aria-label="Infrastructure setup" title="Infrastructure setup" aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        ${settingsBadge}
      </button>
      <button type="button" class="icon-btn" id="envIconBtn" aria-label="Environment & resources" title="Environment & resources" aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="5" rx="1.2"/>
          <rect x="3" y="11" width="18" height="5" rx="1.2"/>
          <rect x="3" y="18" width="18" height="3" rx="1.2"/>
          <circle cx="6.5" cy="6.5" r=".6" fill="currentColor"/>
          <circle cx="6.5" cy="13.5" r=".6" fill="currentColor"/>
        </svg>
      </button>
      <button type="button" class="icon-btn icon-btn-avatar" id="userIconBtn" aria-label="Account" aria-haspopup="true">
        <span class="avatar-initials">A</span>
      </button>
    </div>
  </div>
</header>

<main>
  ${setupAtTop}
  <div id="fleet-container">${fleetSection}</div>
  ${costSection}

  <footer>
    <div id="version-line">v${escapeHtml(version || config.version)}</div>
  </footer>
</main>

<!-- ── Notifications popover ── -->
${notificationsPanel}

<!-- ── User account popover (placeholder until dashboard auth ships) ── -->
<div class="user-popover" id="userPopover" hidden>
  <div class="np-header">
    <strong>Account</strong>
    <button type="button" class="np-close" aria-label="Close" onclick="closeOverlay('userPopover')">×</button>
  </div>
  <div class="up-body">
    <div class="up-avatar"><span class="avatar-initials">A</span></div>
    <div class="up-status">Not signed in</div>
    <p class="up-note">Dashboard authentication is not implemented yet. Until it ships, gate <code>/status</code> with Azure App Service Easy Auth.</p>
    <a href="https://github.com/AtaNdr/CodeLegion/blob/main/auth/IMPLEMENTATION-PLAN.md" target="_blank" rel="noopener" class="link-btn">View implementation plan ↗</a>
  </div>
</div>

<!-- ── Infrastructure setup modal ── -->
<dialog id="setupModal" class="modal-lg" aria-labelledby="setupModalTitle">
  <div class="modal-header">
    <h2 id="setupModalTitle">Infrastructure setup</h2>
    <button type="button" class="modal-close" aria-label="Close" onclick="document.getElementById('setupModal').close()">×</button>
  </div>
  <div class="modal-body">
    ${setupForDrawer || '<p class="muted">Setup wizard not yet available — controller config incomplete.</p>'}
  </div>
</dialog>

<!-- ── Environment & resources modal ── -->
<dialog id="envModal" class="modal-lg" aria-labelledby="envModalTitle">
  <div class="modal-header">
    <h2 id="envModalTitle">Environment &amp; resources</h2>
    <button type="button" class="modal-close" aria-label="Close" onclick="document.getElementById('envModal').close()">×</button>
  </div>
  <div class="modal-body">
    ${discoveryForDrawer || '<p class="muted">Environment data unavailable.</p>'}
  </div>
</dialog>

<!-- ── Existing modals (unchanged) ── -->

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
            <div class="muted" style="font-size:.85rem">Removes the CodeLegion templates from your GitHub repo (CLAUDE.md, DO_NOT_TOUCH.md, ISSUE_TEMPLATEs, …). Issues, PRs, and your own code untouched.</div>
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

<script>${INLINE_SCRIPT}</script>
</body></html>`;
}
