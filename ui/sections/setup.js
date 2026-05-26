// Flow 1 setup section — list of checks with status + remediation buttons.

import { escapeHtml, statusDot, pill } from '../common.js';
import { checks } from '../../flow1/checks.js';

export function renderSetup({ results, summary }) {
  const collapsed = summary.allGreen ? '' : 'open';
  const headline = summary.allGreen
    ? `Setup complete — ${summary.green}/${summary.total} green`
    : `Setup — ${summary.green}/${summary.total} green · ${summary.yellow} warn · ${summary.red} fail · ${summary.unknown} unrun`;

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
    if ((c.id === 'githubApp' || c.id === 'repoAccess') && status !== 'green') {
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
<details ${collapsed}>
  <summary><h2 style="display:inline-block; margin:0">Flow 1 — Infrastructure setup</h2>
    <span class="pill pill-${summary.allGreen ? 'green' : (summary.red > 0 ? 'red' : 'yellow')}">${escapeHtml(headline)}</span>
  </summary>
  <div class="card" style="margin-top:.5rem">
    <div class="spread" style="margin-bottom:.5rem">
      <span class="muted">Run each check individually or all at once. Fixes available where indicated.</span>
      <button class="primary" onclick="runAllChecks()">Run all</button>
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
  <form method="dialog" onsubmit="submitUpload(event)">
    <h2 id="upload-title">Upload</h2>
    <label id="upload-label">Value</label>
    <textarea id="upload-value" required></textarea>
    <div class="row" style="justify-content:flex-end; gap:.5rem; margin-top:.5rem">
      <button type="button" onclick="document.getElementById('upload-modal').close()">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</dialog>

<dialog id="github-config-modal" style="max-width: 520px">
  <form method="dialog" onsubmit="submitGithubConfig(event)">
    <h2 style="margin-top:0">Configure GitHub App</h2>
    <p class="muted" style="margin-top:0">All fields required. From your GitHub App's settings page (Developer settings &rarr; GitHub Apps &rarr; your app).</p>
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
