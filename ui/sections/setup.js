// Flow 1 setup section — list of checks with status + remediation buttons.

import { escapeHtml, statusDot, pill } from '../common.js';
import { checks } from '../../flow1/checks.js';

export function renderSetup({ results, summary }, { inline = false } = {}) {
  // When this section is rendered inline inside Environment & discovery
  // (post-allDone), don't persist its open/closed state and default to
  // closed — so clicking Environment doesn't auto-expand setup. When at
  // top of page (allDone=false), persist + default-open as before.
  const collapsed = inline ? '' : (summary.allDone ? '' : 'open');
  const persistAttr = inline ? '' : 'data-persist';
  const idAttr = inline ? 'id="flow1-details-inline"' : 'id="flow1-details"';
  const skippedNote = summary.skipped ? ` · ${summary.skipped} skipped` : '';
  const headline = summary.allGreen
    ? `Setup complete — ${summary.green}/${summary.total} green`
    : summary.allDone
    ? `Setup complete — ${summary.green}/${summary.total} green${skippedNote}`
    : `Setup — ${summary.green}/${summary.total} green · ${summary.yellow} warn · ${summary.red} fail · ${summary.unknown} unrun${skippedNote}`;

  const rows = checks.map(c => {
    const r = results[c.id];
    const status = r?.status || 'unknown';
    const detail = r?.detail || (r ? '' : 'not yet run');
    const ran = r?.ranAt ? new Date(r.ranAt).toLocaleTimeString() : '';
    const fixable = r?.fixable;
    const remediation = r?.remediation;

    const actions = [];
    actions.push(`<button data-run="${escapeHtml(c.id)}" onclick="runCheck('${escapeHtml(c.id)}')">Run</button>`);
    if (fixable && status !== 'green') {
      actions.push(`<button class="primary" data-fix="${escapeHtml(c.id)}" onclick="fixCheck('${escapeHtml(c.id)}')">Fix</button>`);
    }
    if (c.id === 'anthropic' && status !== 'green') {
      actions.push(`<button onclick="showUploadModal('anthropic')">Upload key</button>`);
    }
    if (c.id === 'githubApp' && status !== 'green') {
      actions.push(`<button onclick="showGithubConfigModal()">Configure App</button>`);
    }

    return `
      <tr>
        <td>${statusDot(status)} ${escapeHtml(c.label)}</td>
        <td>${pill(status, status)}</td>
        <td>${escapeHtml(detail)}${remediation ? `<div class="muted" style="margin-top:2px">${escapeHtml(remediation)}</div>` : ''}</td>
        <td class="muted" style="white-space:nowrap">${escapeHtml(ran)}</td>
        <td><div class="row">${actions.join(' ')}</div></td>
      </tr>`;
  }).join('');

  return `
<details ${idAttr} ${persistAttr} ${collapsed}>
  <summary><h2 style="display:inline-block; margin:0">Infrastructure setup</h2>
    <span class="pill pill-${summary.allDone ? 'green' : (summary.red > 0 ? 'red' : 'yellow')}">${escapeHtml(headline)}</span>
  </summary>
  <div class="card" style="margin-top:.5rem">
    <div class="spread" style="margin-bottom:.5rem">
      <span class="muted">Run each check individually or all at once. Fixes available where indicated.</span>
      <div class="row">
        <button onclick="doInjectRepo()">Inject / update repo files</button>
        <button class="primary" onclick="runAllChecks()">Run all</button>
      </div>
    </div>
    <table>
      <thead><tr>
        <th>Check</th>
        <th>Status</th>
        <th>Detail</th>
        <th>Last run</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</details>

<dialog id="upload-modal">
  <form onsubmit="submitUpload(event); return false;">
    <h2 id="upload-title">Upload</h2>
    <label id="upload-label">Value</label>
    <textarea id="upload-value" required></textarea>
    <div class="row" style="justify-content:flex-end; gap:.5rem; margin-top:.5rem">
      <button type="button" onclick="document.getElementById('upload-modal').close()">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</dialog>

<dialog id="github-config-modal" style="max-width: 560px">
  <form onsubmit="submitGithubConfig(event); return false;">
    <h2 style="margin-top:0">Configure GitHub App</h2>

    <div style="border-left:3px solid var(--info); padding:.5rem .75rem; margin-bottom:1rem; background:color-mix(in srgb, var(--info) 8%, transparent)">
      <p style="margin:0 0 .5rem 0; font-weight:600">1. Create the App on github.com</p>
      <p class="muted" style="margin:0 0 .5rem 0">Developer settings → GitHub Apps → New. Use these values:</p>
      <div style="display:grid; gap:.4rem">
        <div>
          <label style="display:block; font-size:.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em">Webhook URL</label>
          <div class="row" style="gap:.4rem; margin-top:.15rem">
            <code id="gh-webhook-url" style="flex:1; word-break:break-all; padding:.25rem .5rem">loading…</code>
            <button type="button" onclick="copyEl('gh-webhook-url', this)">Copy</button>
          </div>
        </div>
        <div>
          <label style="display:block; font-size:.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em">Webhook secret</label>
          <div class="row" style="gap:.4rem; margin-top:.15rem">
            <code id="gh-webhook-secret" style="flex:1; word-break:break-all; padding:.25rem .5rem">loading…</code>
            <button type="button" onclick="copyEl('gh-webhook-secret', this)">Copy</button>
          </div>
        </div>
        <p class="muted" style="margin:.25rem 0 0 0; font-size:.85rem">Permissions: Contents R/W, Issues R/W, Pull requests R/W, Metadata R, Workflows R/W, Administration R/W. Subscribe to: Issues, Issue comment, Pull request, Pull request review.</p>
      </div>
    </div>

    <p style="margin:0 0 .5rem 0; font-weight:600">2. Paste back the App's IDs and private key</p>
    <div style="display:grid; gap:.6rem">
      <div>
        <label for="gh-app-id" style="display:block; font-size:.85rem; color:var(--muted)">App ID</label>
        <input id="gh-app-id" name="appId" type="text" required placeholder="e.g. 123456">
      </div>
      <div>
        <label for="gh-installation-id" style="display:block; font-size:.85rem; color:var(--muted)">Installation ID</label>
        <input id="gh-installation-id" name="installationId" type="text" required placeholder="e.g. 78901234">
      </div>
      <div class="row" style="gap:.6rem">
        <div style="flex:1">
          <label for="gh-owner" style="display:block; font-size:.85rem; color:var(--muted)">Repo owner</label>
          <input id="gh-owner" name="owner" type="text" required placeholder="e.g. yourname">
        </div>
        <div style="flex:1">
          <label for="gh-repo" style="display:block; font-size:.85rem; color:var(--muted)">Repo name</label>
          <input id="gh-repo" name="repo" type="text" required placeholder="e.g. my-project">
        </div>
      </div>
      <div>
        <label for="gh-pem" style="display:block; font-size:.85rem; color:var(--muted)">Private key (PEM)</label>
        <textarea id="gh-pem" name="privateKey" required placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."></textarea>
      </div>
    </div>
    <div class="row" style="justify-content:flex-end; gap:.5rem; margin-top:.75rem">
      <button type="button" onclick="document.getElementById('github-config-modal').close()">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</dialog>
`;
}
