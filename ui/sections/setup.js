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
    if (c.id === 'githubApp' && status !== 'green') {
      actions.push(`<button onclick="showUploadModal('github')">Upload PEM</button>`);
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
`;
}
