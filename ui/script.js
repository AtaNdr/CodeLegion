// Inline browser-side script for the status page.
// Exported as a string so render.js can splice it into the HTML.

export const INLINE_SCRIPT = `
// Promise-based confirmation modal (replaces native confirm()).
// Usage: const ok = await showConfirm({title, body, okLabel, danger});
let _confirmResolver = null;
function showConfirm({ title = 'Confirm', body = 'Are you sure?', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const titleEl = document.getElementById('confirm-title');
    const bodyEl = document.getElementById('confirm-body');
    const okBtn = document.getElementById('confirm-ok-btn');
    const dlg = document.getElementById('confirm-modal');
    if (!dlg) { resolve(window.confirm(body)); return; }  // fallback if modal not present
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (okBtn) {
      okBtn.textContent = okLabel;
      okBtn.className = danger ? 'danger' : 'primary';
    }
    _confirmResolver = resolve;
    dlg.addEventListener('close', _onConfirmClose, { once: true });
    dlg.showModal();
  });
}
function _onConfirmClose() {
  if (_confirmResolver) { _confirmResolver(false); _confirmResolver = null; }
}
function resolveConfirm(answer) {
  const dlg = document.getElementById('confirm-modal');
  const resolver = _confirmResolver;
  _confirmResolver = null;
  if (dlg) dlg.close();
  if (resolver) resolver(answer);
}

// Toast notifications. showToast(msg, {type, duration}) → handle with
// update()/dismiss(). type: info | success | error | loading. A loading
// toast persists (duration ignored) until you dismiss or update it.
function showToast(message, { type = 'info', duration = 4000 } = {}) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  const spinner = document.createElement('span');
  const text = document.createElement('span');
  function render(msg, t) {
    el.className = 'toast toast-' + t + (el.classList.contains('show') ? ' show' : '');
    spinner.className = 'spinner';
    if (t === 'loading') { if (!spinner.parentNode) el.insertBefore(spinner, el.firstChild); }
    else if (spinner.parentNode) spinner.remove();
    text.textContent = msg;
  }
  el.appendChild(text);
  render(message, type);
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  };
  const arm = (d, t) => { if (t !== 'loading' && d) timer = setTimeout(dismiss, d); };
  arm(duration, type);

  return {
    update(msg, t = 'info', d = 4000) { if (timer) clearTimeout(timer); render(msg, t); arm(d, t); },
    dismiss,
  };
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return r.json().catch(() => ({}));
}

// Admin endpoints under /admin/* require X-Admin-Token. The token is rendered
// into a meta tag on page load (see render.js).
function adminToken() {
  const m = document.querySelector('meta[name="codelegion-admin-token"]');
  return m ? m.getAttribute('content') : '';
}
async function adminFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {}, { 'X-Admin-Token': adminToken() });
  return fetch(url, Object.assign({}, opts, { headers }));
}
async function postAdmin(url, body) {
  const r = await adminFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return r.json().catch(() => ({}));
}

async function runCheck(id) {
  const btn = document.querySelector(\`[data-run="\${id}"]\`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try { await postJson('/setup/check/' + encodeURIComponent(id)); }
  finally { location.reload(); }
}

async function runAllChecks() {
  document.querySelectorAll('[data-run]').forEach(b => b.disabled = true);
  try { await postJson('/setup/run-all'); }
  finally { location.reload(); }
}

async function fixCheck(id) {
  const ok = await showConfirm({
    title: 'Run remediation',
    body: 'Apply the Fix for "' + id + '"?',
    okLabel: 'Run Fix',
  });
  if (!ok) return;
  const btn = document.querySelector(\`[data-fix="\${id}"]\`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const t = showToast('Running fix for ' + id + '… (re-verifying, ~10s)', { type: 'loading' });
  try {
    await postJson('/setup/action/' + encodeURIComponent(id));
    t.update('Fix applied for ' + id + ' — refreshing', 'success', 3000);
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    t.update('Fix failed for ' + id + ': ' + e.message, 'error', 8000);
    if (btn) { btn.disabled = false; btn.textContent = 'Fix'; }
  }
}

const UPLOAD_CONFIGS = {
  anthropic: { title: 'Upload Anthropic API key', label: 'sk-ant-... key', endpoint: '/setup/upload-anthropic-key', key: 'apiKey' },
};

function showUploadModal(kind) {
  const cfg = UPLOAD_CONFIGS[kind];
  if (!cfg) return;
  const modal = document.getElementById('upload-modal');
  document.getElementById('upload-title').textContent = cfg.title;
  document.getElementById('upload-label').textContent = cfg.label;
  const v = document.getElementById('upload-value');
  v.value = '';
  v.dataset.kind = kind;
  modal.showModal();
}

async function submitUpload(ev) {
  ev.preventDefault();
  const v = document.getElementById('upload-value');
  const kind = v.dataset.kind;
  const cfg = UPLOAD_CONFIGS[kind];
  if (!cfg) return;
  try {
    await postJson(cfg.endpoint, { [cfg.key]: v.value });
    document.getElementById('upload-modal').close();
    location.reload();
  } catch (e) {
    alert('Upload failed: ' + e.message);
  }
}

async function showGithubConfigModal() {
  const modal = document.getElementById('github-config-modal');
  if (!modal) return;
  const urlEl = document.getElementById('gh-webhook-url');
  const secretEl = document.getElementById('gh-webhook-secret');
  if (urlEl) urlEl.textContent = 'loading…';
  if (secretEl) secretEl.textContent = 'loading…';
  modal.showModal();
  try {
    const r = await fetch('/setup/gh-app-prep');
    if (r.ok) {
      const data = await r.json();
      if (urlEl) urlEl.textContent = data.webhookUrl || '(unknown — set CONTROLLER_PUBLIC_URL)';
      if (secretEl) secretEl.textContent = data.webhookSecret || '(generation failed)';
    } else {
      const msg = '(error ' + r.status + ')';
      if (urlEl) urlEl.textContent = msg;
      if (secretEl) secretEl.textContent = msg;
    }
  } catch (e) {
    if (urlEl) urlEl.textContent = '(fetch failed)';
    if (secretEl) secretEl.textContent = '(fetch failed)';
  }
}

async function copyEl(elementId, btn) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (e) {
    alert('Copy failed — select and copy manually.');
  }
}

async function submitGithubConfig(ev) {
  ev.preventDefault();
  const form = ev.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const submitBtn = form.querySelector('button[type=submit]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
  try {
    // Order matters: config first (sets IDs), then key (clears token cache).
    await postJson('/setup/upload-gh-config', {
      appId: data.appId,
      installationId: data.installationId,
      owner: data.owner,
      repo: data.repo,
    });
    await postJson('/setup/upload-gh-key', { privateKey: data.privateKey });
    document.getElementById('github-config-modal').close();
    location.reload();
  } catch (e) {
    alert('Save failed: ' + e.message);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
  }
}

// Fleet (Phase 4+) helpers
// [loading-label, success-label] per action.
const VM_ACTION_LABELS = {
  wake: ['Waking', 'wake requested'],
  sleep: ['Sleeping', 'sleep requested'],
  delete: ['Deleting', 'deleted'],
  'force-sync': ['Syncing', 'synced from VM'],
};
async function vmAction(name, action) {
  if (action === 'delete') {
    const ok = await showConfirm({
      title: 'Delete VM',
      body: 'Delete ' + name + '? Disk and state are lost — this cannot be undone.',
      okLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
  }
  const [ing, done] = VM_ACTION_LABELS[action] || [action, action];
  const t = showToast(ing + ' ' + name + '…', { type: 'loading' });
  try {
    if (action === 'delete') {
      const r = await adminFetch('/admin/vm/' + encodeURIComponent(name), { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    } else {
      await postAdmin('/admin/vm/' + encodeURIComponent(name) + '/' + action);
    }
    t.update(name + ' — ' + done, 'success', 4000);
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    t.update(ing + ' ' + name + ' failed: ' + e.message, 'error', 8000);
  }
}
async function doCleanupOrphans() {
  const ok = await showConfirm({
    title: 'Cleanup orphan resources',
    body: 'Sweep failed VMs (cascades NIC+disk), orphan NICs holding subnet IPs, and orphan OS disks left behind by old VM creates. Safe — only touches resources matching our agent naming and Purpose tag.',
    okLabel: 'Cleanup',
  });
  if (!ok) return;
  const t = showToast('Scanning for orphan resources…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/cleanup-orphans');
    const d = r.deleted || { vms: [], nics: [], disks: [] };
    const parts = [];
    if (d.vms?.length) parts.push(d.vms.length + ' VM(s)');
    if (d.nics?.length) parts.push(d.nics.length + ' NIC(s)');
    if (d.disks?.length) parts.push(d.disks.length + ' disk(s)');
    const total = (d.vms?.length || 0) + (d.nics?.length || 0) + (d.disks?.length || 0);
    const e = (r.errors || []).length;
    const msg = parts.length ? 'Deleted ' + parts.join(', ') : 'No orphans found';
    t.update(msg + (e ? ' — ' + e + ' errors' : ''), e ? 'error' : 'success', 6000);
    if (total > 0) setTimeout(() => location.reload(), 2000);
  } catch (e) {
    t.update('Cleanup failed: ' + e.message, 'error', 8000);
  }
}

async function showReconcileHistory() {
  try {
    const r = await fetch('/admin/reconcile/history');
    const data = await r.json();
    const runs = data.runs || [];
    const dlg = document.getElementById('timeline-modal');
    document.getElementById('timeline-title').textContent = 'Reconcile history (' + runs.length + ' runs · newest first)';
    if (runs.length === 0) {
      document.getElementById('timeline-body').textContent = '(no runs yet)';
    } else {
      const formatted = runs.map(function(r) {
        const when = r.at ? new Date(r.at).toLocaleTimeString() : '?';
        if (r.error) return when + ' · ERROR: ' + r.error;
        const u = (r.unclaimed || []).map(function(i) { return '#' + i.issue + (i.onboarding ? '(ob)' : '') + ':' + i.model; }).join(',') || 'none';
        const a = (r.assigned || []).map(function(x) { return '#' + x.issue + '→' + x.vm; }).join(',') || 'none';
        const ca = (r.capacityActions || []).map(function(x) {
          return x.model + ':' + x.action + (x.vmName ? ' ' + x.vmName : '') + (x.error ? ' (' + x.error.slice(0, 60) + ')' : '');
        }).join(' · ') || 'none';
        return when + ' · alive ' + (r.aliveCount || 0) + ' free ' + (r.freeCount || 0)
          + ' · unclaimed: ' + u
          + ' · assigned: ' + a
          + ' · capacity: ' + ca;
      }).join('\\n');
      document.getElementById('timeline-body').textContent = formatted;
    }
    dlg.showModal();
  } catch (e) {
    showToast('Could not load history: ' + e.message, { type: 'error', duration: 6000 });
  }
}

async function doReconcile() {
  const t = showToast('Running reconcile…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/reconcile');
    const n = (r.lastRun && r.lastRun.assigned ? r.lastRun.assigned.length : 0);
    const u = (r.lastRun && r.lastRun.unclaimedCount) || 0;
    t.update('Reconcile done — ' + u + ' unclaimed, ' + n + ' newly assigned', 'success', 5000);
    setTimeout(() => location.reload(), 2000);
  } catch (e) {
    t.update('Reconcile failed: ' + e.message, 'error', 8000);
  }
}

async function fleetAction(action) {
  const label = action === 'wake-all' ? 'Waking all agents'
    : action === 'sleep-all' ? 'Sleeping all agents' : action;
  const t = showToast(label + '…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/' + action);
    const affected = (r.woken || r.slept || []).length;
    t.update(label + ' — ' + affected + ' affected', 'success', 4000);
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    t.update(label + ' failed: ' + e.message, 'error', 8000);
  }
}
async function showTimeline(vmName) {
  const r = await fetch('/admin/vm/' + encodeURIComponent(vmName) + '/timeline');
  const data = await r.json();
  const lines = (data.events || []).map(e => \`\${e.ts || '?'} · \${e.state || '?'} · \${e.issue ? '#' + e.issue : ''} \${e.summary || ''}\`).join('\\n');
  const dlg = document.getElementById('timeline-modal');
  if (!dlg) { alert(lines || 'no events'); return; }
  document.getElementById('timeline-title').textContent = 'Timeline · ' + vmName;
  document.getElementById('timeline-body').textContent = lines || '(no events)';
  dlg.showModal();
}
async function showLog(vmName) {
  const r = await fetch('/agent/logs/' + encodeURIComponent(vmName));
  const text = await r.text();
  const dlg = document.getElementById('timeline-modal');
  if (!dlg) { alert(text); return; }
  document.getElementById('timeline-title').textContent = 'Raw log · ' + vmName + ' (' + (text ? text.length.toLocaleString() + ' chars' : 'empty') + ')';
  // Show the FULL log (cumulative across the VM's lifetime). Previously
  // truncated to the last 8000 chars which made older entries appear to be
  // "overridden" by new ones — they were always on disk, just not displayed.
  // Modal already has overflow:auto + max-height, so a long log scrolls.
  document.getElementById('timeline-body').textContent = text || '(empty)';
  // Auto-scroll to the latest entry — that's usually what you want.
  const body = document.getElementById('timeline-body');
  requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  dlg.showModal();
}
async function promptSpin() {
  const model = prompt('Model (haiku/sonnet/opus)?', 'sonnet');
  if (!model) return;
  const t = showToast('Creating ' + model + ' agent…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/spin', { model });
    t.update('Agent VM creating: ' + (r.vmName || 'started'), 'success', 5000);
    setTimeout(() => location.reload(), 2000);
  } catch (e) {
    t.update('Create failed: ' + e.message, 'error', 8000);
  }
}

async function doSelfUpdate() {
  const ok = await showConfirm({
    title: 'Self-update',
    body: 'Pull latest release and restart? The Web App will be unavailable for ~60s.',
    okLabel: 'Update now',
  });
  if (!ok) return;
  const t = showToast('Triggering self-update…', { type: 'loading' });
  try {
    await postAdmin('/admin/self-update');
    t.update('Update triggered — the Web App is restarting (~60s). Refresh the page after that.', 'success', 10000);
  } catch (e) {
    t.update('Self-update failed: ' + e.message, 'error', 8000);
  }
}

function summarizeResults(results) {
  const counts = (results || []).reduce((acc, x) => { acc[x.action] = (acc[x.action] || 0) + 1; return acc; }, {});
  return Object.entries(counts).map(([k, v]) => k + ' ' + v).join(', ') || 'no changes';
}

async function doInjectRepo() {
  const ok = await showConfirm({
    title: 'Inject / update repo files',
    body: 'Push the contract files (CLAUDE.md, COMMENT_STYLE.md, labels, etc.) into the target repo. Always-overwrite files are refreshed; project files (CONTEXT/ARCHITECTURE/DESIGN/LESSONS/…) are only created if missing.',
    okLabel: 'Inject',
  });
  if (!ok) return;
  const t = showToast('Injecting repo files…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/inject-repo');
    t.update('Repo files injected: ' + summarizeResults(r.results), 'success', 5000);
    setTimeout(() => location.reload(), 2500);  // refresh check status
  } catch (e) {
    t.update('Inject failed: ' + e.message, 'error', 8000);
  }
}

async function doCleanRepo() {
  const ok = await showConfirm({
    title: 'Clean repo files',
    body: 'Remove the always-overwrite contract files CodeLegion injected. Project files you may have edited (CONTEXT/ARCHITECTURE/DESIGN/LESSONS) are left alone.',
    okLabel: 'Clean',
    danger: true,
  });
  if (!ok) return;
  const t = showToast('Cleaning repo files…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/clean-repo');
    t.update('Repo files cleaned: ' + summarizeResults(r.results), 'success', 5000);
    setTimeout(() => location.reload(), 2500);
  } catch (e) {
    t.update('Clean failed: ' + e.message, 'error', 8000);
  }
}

// Persist <details data-persist> open/closed state across reloads so the
// auto-refresh / post-action reload doesn't fight the user (e.g. Flow 1
// re-collapsing every time you click Run once setup is complete).
(function persistDetails() {
  document.querySelectorAll('details[data-persist]').forEach((d) => {
    const key = 'cl-details:' + (d.id || 'anon');
    const saved = localStorage.getItem(key);
    if (saved === 'open') d.open = true;
    else if (saved === 'closed') d.open = false;
    d.addEventListener('toggle', () => localStorage.setItem(key, d.open ? 'open' : 'closed'));
  });
})();

// Auto-refresh every 30s, but skip while any <dialog> is open. Modal flows
// (Configure App, log/timeline viewer) take longer than 30s; reloading
// mid-flow would destroy the user's input.
setInterval(() => {
  if (document.querySelector('dialog[open]')) return;
  if (document.querySelector('.toast-loading')) return;  // don't interrupt an in-flight action
  location.reload();
}, 30000);

// Lazy-fetch version + update-available pill, populate the footer line.
(async function loadVersionInfo() {
  const el = document.getElementById('version-line');
  if (!el) return;
  try {
    const r = await fetch('/api/version');
    if (!r.ok) return;
    const v = await r.json();
    let html = 'v' + (v.version || '?');
    if (v.commit) html += ' · ' + v.commit.slice(0, 7);
    if (v.update?.hasUpdate && v.update.latestVersion) {
      const href = v.update.latestHtmlUrl || '#';
      html += ' · <a href="' + href + '" target="_blank" rel="noopener"><span class="pill pill-yellow">Update available: ' + v.update.latestVersion + '</span></a>';
      html += ' <button class="primary" style="margin-left:.5rem; padding:.15rem .6rem; font-size:.8rem" onclick="doSelfUpdate()">Update now</button>';
    } else if (v.update?.latestVersion) {
      html += ' · <span class="muted">latest: ' + v.update.latestVersion + '</span>';
    }
    el.innerHTML = html;
  } catch {}
})();
`;
