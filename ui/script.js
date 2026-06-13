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
function showVmConfigModal() {
  ['haiku', 'sonnet', 'opus'].forEach(m => { const el = document.getElementById('vm-size-' + m); if (el) el.value = ''; });
  document.getElementById('vm-config-modal').showModal();
}

async function submitVmConfig(event) {
  event.preventDefault();
  const body = {};
  for (const m of ['haiku', 'sonnet', 'opus']) {
    const v = document.getElementById('vm-size-' + m).value.trim();
    if (v) body[m] = v;
  }
  if (Object.keys(body).length === 0) {
    showToast('Enter at least one size', { type: 'error', duration: 4000 });
    return;
  }
  document.getElementById('vm-config-modal').close();
  const t = showToast('Saving VM sizes…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/vm-config', body);
    const keys = Object.keys(r.patch || {}).map(k => k.replace('VM_SIZE_', '').toLowerCase()).join(', ');
    t.update('Saved: ' + keys + '. App Service will restart.', 'success', 6000);
    setTimeout(() => location.reload(), 1800);
  } catch (e) {
    t.update('Save failed: ' + e.message, 'error', 8000);
  }
}

// Pricing -- extras outside the models map (e.g. _lastVerified) are
// preserved across edits so they round-trip cleanly. _source is a
// runtime marker from the loader, never written back.
let _pricingExtras = {};

function pricingFieldsTpl(name, rates) {
  const r = rates || {};
  const safe = (v) => v == null ? '' : String(v);
  const safeName = (name || '').replace(/"/g, '&quot;');
  return '<tr data-model-row>'
    + '<td><input type="text" name="model" value="' + safeName + '" required placeholder="e.g. sonnet" style="width:100%"></td>'
    + '<td><input type="number" name="input"        value="' + safe(r.input) + '"        step="any" min="0" required style="width:100%; text-align:right"></td>'
    + '<td><input type="number" name="output"       value="' + safe(r.output) + '"       step="any" min="0" required style="width:100%; text-align:right"></td>'
    + '<td><input type="number" name="cacheRead"    value="' + safe(r.cacheRead) + '"    step="any" min="0" required style="width:100%; text-align:right"></td>'
    + '<td><input type="number" name="cacheWrite5m" value="' + safe(r.cacheWrite5m) + '" step="any" min="0" required style="width:100%; text-align:right"></td>'
    + '<td><button type="button" class="danger" onclick="this.closest(\\'tr\\').remove()" title="Remove model" style="padding:.2rem .5rem">✕</button></td>'
    + '</tr>';
}

function addPricingRow() {
  const tbody = document.getElementById('pricing-rows');
  tbody.insertAdjacentHTML('beforeend', pricingFieldsTpl('', {}));
  const inputs = tbody.querySelectorAll('tr:last-child input');
  if (inputs.length) inputs[0].focus();
}

async function showPricingModal() {
  const tbody = document.getElementById('pricing-rows');
  tbody.innerHTML = '<tr><td colspan="6" class="muted">loading…</td></tr>';
  document.getElementById('pricing-modal').showModal();
  try {
    const r = await fetch('/admin/pricing');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const v = await r.json();
    const models = (v && v.models) || {};
    _pricingExtras = {};
    for (const [k, val] of Object.entries(v || {})) {
      if (k !== 'models' && k !== '_source') _pricingExtras[k] = val;
    }
    const names = Object.keys(models);
    if (names.length === 0) names.push('haiku', 'sonnet', 'opus');
    tbody.innerHTML = names.map(n => pricingFieldsTpl(n, models[n])).join('');
  } catch (e) {
    tbody.innerHTML = pricingFieldsTpl('', {});
    showToast('Could not load current pricing: ' + e.message, { type: 'error', duration: 6000 });
  }
}

async function submitPricing(event) {
  event.preventDefault();
  const tbody = document.getElementById('pricing-rows');
  const rows = tbody.querySelectorAll('tr[data-model-row]');
  const models = {};
  const seen = new Set();
  for (const row of rows) {
    const name = row.querySelector('input[name="model"]').value.trim();
    if (!name) { showToast('Every row needs a model name', { type: 'error', duration: 4000 }); return; }
    if (seen.has(name)) { showToast('Duplicate model name: ' + name, { type: 'error', duration: 4000 }); return; }
    seen.add(name);
    const num = (k) => {
      const raw = row.querySelector('input[name="' + k + '"]').value;
      const v = Number(raw);
      if (raw === '' || !Number.isFinite(v) || v < 0) throw new Error(name + '.' + k);
      return v;
    };
    try {
      models[name] = { input: num('input'), output: num('output'), cacheRead: num('cacheRead'), cacheWrite5m: num('cacheWrite5m') };
    } catch (e) {
      showToast('Invalid number for ' + e.message, { type: 'error', duration: 5000 });
      return;
    }
  }
  if (Object.keys(models).length === 0) {
    showToast('Add at least one model row', { type: 'error', duration: 4000 });
    return;
  }
  const payload = { ..._pricingExtras, models };
  document.getElementById('pricing-modal').close();
  const t = showToast('Saving pricing override…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/pricing-override', { json: JSON.stringify(payload) });
    t.update('Pricing override saved (' + (r.models || 0) + ' models)', 'success', 5000);
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    t.update('Save failed: ' + e.message, 'error', 8000);
  }
}

async function clearPricing() {
  const ok = await showConfirm({
    title: 'Clear pricing override',
    body: 'Revert to the bundled pricing.json. Cost calculations switch back immediately.',
    okLabel: 'Clear',
  });
  if (!ok) return;
  document.getElementById('pricing-modal').close();
  const t = showToast('Clearing pricing override…', { type: 'loading' });
  try {
    await postAdmin('/admin/pricing-override', { json: null });
    t.update('Override cleared. Bundled pricing in use.', 'success', 5000);
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    t.update('Clear failed: ' + e.message, 'error', 8000);
  }
}

function showUninstallModal() {
  const m = document.getElementById('uninstall-modal');
  m.querySelectorAll('input[name="scope"]').forEach(r => r.checked = false);
  document.getElementById('uninstall-confirm-text').value = '';
  m.showModal();
}

async function submitUninstall(event) {
  event.preventDefault();
  const form = event.target;
  const scope = (form.scope && form.scope.value) || '';
  const typed = document.getElementById('uninstall-confirm-text').value;
  if (!scope) { showToast('Pick a scope', { type: 'error', duration: 4000 }); return; }
  if (typed !== 'UNINSTALL') { showToast('Type UNINSTALL exactly to confirm', { type: 'error', duration: 4000 }); return; }
  document.getElementById('uninstall-modal').close();

  const labels = { repo: 'repo files', azure: 'Azure resources', both: 'repo + Azure' };
  const t = showToast('Uninstalling ' + labels[scope] + '… (this can take a couple minutes for Azure)', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/uninstall/' + scope);
    const lines = [];
    if (r.repo) {
      const removed = (r.repo.results || []).filter(x => x.action === 'deleted').length;
      const errs = (r.repo.results || []).filter(x => x.action === 'error').length;
      lines.push('repo: ' + removed + ' file(s) removed' + (errs ? ', ' + errs + ' error(s)' : ''));
    }
    if (r.azure) {
      const d = (r.azure.deleted || []).length;
      const u = (r.azure.unknown || []).length;
      const e = (r.azure.errors || []).length;
      let line = 'azure: ' + d + ' resource(s) deleted';
      if (u) line += ', ' + u + ' unrecognised left in place';
      if (e) line += ', ' + e + ' error(s)';
      lines.push(line);
    }
    const hasErr = (r.repo?.results || []).some(x => x.action === 'error') || (r.azure?.errors || []).length > 0;
    t.update('Uninstall complete — ' + lines.join(' · '), hasErr ? 'error' : 'success', 10000);
    setTimeout(() => location.reload(), 2500);
  } catch (e) {
    t.update('Uninstall failed: ' + e.message, 'error', 10000);
  }
}

async function doPauseFleet() {
  const ok = await showConfirm({
    title: 'Stop fleet',
    body: 'Halts reconcile and deallocates every running agent. Webhooks keep arriving but do nothing until you click Start fleet. The controller and UI stay up.',
    okLabel: 'Stop fleet',
  });
  if (!ok) return;
  const t = showToast('Stopping fleet…', { type: 'loading' });
  try {
    const r = await postAdmin('/admin/fleet/pause');
    const n = (r.slept || []).length;
    t.update('Fleet stopped' + (n ? ' — deallocated ' + n + ' agent(s)' : ''), 'success', 5000);
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    t.update('Stop failed: ' + e.message, 'error', 8000);
  }
}

async function doResumeFleet() {
  const t = showToast('Starting fleet…', { type: 'loading' });
  try {
    await postAdmin('/admin/fleet/resume');
    t.update('Fleet started — reconcile will run shortly', 'success', 4000);
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    t.update('Start failed: ' + e.message, 'error', 8000);
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

function clEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}
function clIssueLink(n) {
  if (n == null || n === '') return '';
  const meta = document.querySelector('meta[name="codelegion-repo"]');
  const repo = meta ? meta.getAttribute('content') : null;
  if (!repo) return '#' + clEscape(n);
  return '<a href="https://github.com/' + clEscape(repo) + '/issues/' + encodeURIComponent(n)
       + '" target="_blank" rel="noopener" class="issue-link">#' + clEscape(n) + '</a>';
}

async function showReconcileHistory() {
  try {
    const r = await fetch('/admin/reconcile/history');
    const data = await r.json();
    const runs = data.runs || [];
    const dlg = document.getElementById('timeline-modal');
    document.getElementById('timeline-title').textContent = 'Reconcile history (' + runs.length + ' runs · newest first)';
    const body = document.getElementById('timeline-body');
    if (runs.length === 0) {
      body.textContent = '(no runs yet)';
    } else {
      const formatted = runs.map(function(r) {
        const when = r.at ? new Date(r.at).toLocaleTimeString() : '?';
        if (r.error) return clEscape(when) + ' · ERROR: ' + clEscape(r.error);
        const u = (r.unclaimed || []).map(function(i) {
          return clIssueLink(i.issue) + (i.onboarding ? '(ob)' : '') + ':' + clEscape(i.model);
        }).join(',') || 'none';
        const a = (r.assigned || []).map(function(x) {
          const target = x.agentName
            ? (x.agentEmoji ? clEscape(x.agentEmoji) + ' ' : '') + clEscape(x.agentName)
            : clEscape(x.vm);
          return clIssueLink(x.issue) + '→' + target;
        }).join(',') || 'none';
        const ca = (r.capacityActions || []).map(function(x) {
          return clEscape(x.model) + ':' + clEscape(x.action)
               + (x.vmName ? ' ' + clEscape(x.vmName) : '')
               + (x.error ? ' (' + clEscape(x.error.slice(0, 60)) + ')' : '');
        }).join(' · ') || 'none';
        return clEscape(when) + ' · alive ' + (r.aliveCount || 0) + ' free ' + (r.freeCount || 0)
          + ' · unclaimed: ' + u
          + ' · assigned: ' + a
          + ' · capacity: ' + ca;
      }).join('\\n');
      body.innerHTML = formatted;
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
  const lines = (data.events || []).map(function(e) {
    const ts = clEscape(e.ts || '?');
    const state = clEscape(e.state || '?');
    const issue = e.issue ? clIssueLink(e.issue) : '';
    const summary = clEscape(e.summary || '');
    return ts + ' · ' + state + ' · ' + issue + ' ' + summary;
  }).join('\\n');
  const dlg = document.getElementById('timeline-modal');
  if (!dlg) { alert(lines || 'no events'); return; }
  document.getElementById('timeline-title').textContent = 'Timeline · ' + vmName;
  const body = document.getElementById('timeline-body');
  if (lines) { body.innerHTML = lines; } else { body.textContent = '(no events)'; }
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

// Auto-refresh every 30s — only the fleet section. The rest of the page
// (Environment & discovery, Infrastructure setup, Cost) is static enough
// that full reloads would flicker for no benefit. Modal/loading guards
// keep an in-flight action from being clobbered.
async function refreshFleetSection() {
  if (document.querySelector('dialog[open]')) return;
  if (document.querySelector('.toast-loading')) return;
  const host = document.getElementById('fleet-container');
  if (!host) return;
  try {
    const r = await fetch('/fleet/section', { cache: 'no-store' });
    if (!r.ok) return;
    const html = await r.text();
    host.innerHTML = html;
  } catch { /* network blip — try again next tick */ }
}
setInterval(refreshFleetSection, 30000);

// =====================================================================
// Header icons — Notifications popover, Settings drawer, User popover.
// Only one overlay open at a time. Click outside / ESC closes everything.
// =====================================================================
const DISMISSED_NOTES_KEY = 'cl-dismissed-notes';
function getDismissedNotes() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_NOTES_KEY) || '[]')); }
  catch { return new Set(); }
}
function setDismissedNotes(set) {
  try { localStorage.setItem(DISMISSED_NOTES_KEY, JSON.stringify([...set])); } catch {}
}

function openOverlay(id) {
  closeAllOverlays();
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = false;
  // Force reflow so the transition runs.
  void el.offsetHeight;
  el.classList.add('open');
  if (id === 'settingsDrawer') {
    const bd = document.getElementById('drawerBackdrop');
    if (bd) { bd.hidden = false; void bd.offsetHeight; bd.classList.add('open'); }
  }
  // Highlight the source button.
  const btn = id === 'settingsDrawer' ? document.getElementById('settingsIconBtn')
    : id === 'notificationsPanel' ? document.getElementById('notifIconBtn')
    : id === 'userPopover' ? document.getElementById('userIconBtn') : null;
  if (btn) btn.setAttribute('aria-expanded', 'true');
}
function closeOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => { el.hidden = true; }, 250);
  if (id === 'settingsDrawer') {
    const bd = document.getElementById('drawerBackdrop');
    if (bd) { bd.classList.remove('open'); setTimeout(() => { bd.hidden = true; }, 250); }
  }
  const btn = id === 'settingsDrawer' ? document.getElementById('settingsIconBtn')
    : id === 'notificationsPanel' ? document.getElementById('notifIconBtn')
    : id === 'userPopover' ? document.getElementById('userIconBtn') : null;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
function closeAllOverlays() {
  ['notificationsPanel', 'settingsDrawer', 'userPopover'].forEach(closeOverlay);
}

// =====================================================================
// Theme toggle. Three states cycled by click: auto → light → dark → auto.
// "auto" is the absence of data-theme on <html>, so the existing
// prefers-color-scheme media query keeps applying. The user's pick is
// stored in localStorage; "auto" stores nothing so a future visit
// silently picks up a changed system preference.
// =====================================================================
const THEME_KEY = 'cl-theme';
(function initTheme() {
  let stored;
  try { stored = localStorage.getItem(THEME_KEY); } catch { stored = null; }
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  }
  // Otherwise leave the attribute absent → auto mode.
})();
function cycleTheme() {
  // Two-state toggle between explicit light and dark. On first click from
  // auto mode, resolve the system preference and flip to its opposite so
  // the click visibly changes something.
  const cur = document.documentElement.getAttribute('data-theme');
  let effective = cur;
  if (!effective) {
    effective = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }
  const next = effective === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
}

// Wire up header buttons + dismiss handlers + ESC + click-outside.
(function wireHeader() {
  const themeBtn = document.getElementById('themeIconBtn');
  const notifBtn = document.getElementById('notifIconBtn');
  const setBtn   = document.getElementById('settingsIconBtn');
  const userBtn  = document.getElementById('userIconBtn');
  if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
  if (notifBtn) notifBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleOverlay('notificationsPanel'); });
  if (setBtn)   setBtn.addEventListener('click',   (e) => { e.stopPropagation(); toggleOverlay('settingsDrawer'); });
  if (userBtn)  userBtn.addEventListener('click',  (e) => { e.stopPropagation(); toggleOverlay('userPopover'); });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllOverlays(); });

  // Click-outside closes popovers (drawer has its own backdrop already).
  document.addEventListener('click', (e) => {
    const np = document.getElementById('notificationsPanel');
    const up = document.getElementById('userPopover');
    if (np && !np.hidden && !np.contains(e.target) && !notifBtn?.contains(e.target)) closeOverlay('notificationsPanel');
    if (up && !up.hidden && !up.contains(e.target) && !userBtn?.contains(e.target)) closeOverlay('userPopover');
  });

  // Wire each notification's dismiss + action button.
  const list = document.getElementById('notificationsList');
  if (list) {
    list.addEventListener('click', (e) => {
      const dismissBtn = e.target.closest('[data-dismiss]');
      if (dismissBtn) {
        const id = dismissBtn.getAttribute('data-dismiss');
        const set = getDismissedNotes(); set.add(id); setDismissedNotes(set);
        const item = dismissBtn.closest('.note');
        if (item) item.remove();
        const remaining = list.querySelectorAll('.note').length;
        if (remaining === 0) {
          list.innerHTML = '<li class="np-empty">All clear.</li>';
        }
        // Update badge.
        updateNotifBadge();
        return;
      }
      const actionBtn = e.target.closest('.note-action');
      if (actionBtn) {
        const handler = actionBtn.getAttribute('data-handler');
        const target = actionBtn.getAttribute('data-target');
        closeOverlay('notificationsPanel');
        if (handler && typeof window[handler] === 'function') window[handler]();
        else if (target) openOverlay(target);
      }
    });
  }

  // Hide already-dismissed notifications on page load.
  const dismissed = getDismissedNotes();
  document.querySelectorAll('.note[data-note-id]').forEach((n) => {
    if (dismissed.has(n.getAttribute('data-note-id'))) n.remove();
  });
  if (list && list.querySelectorAll('.note').length === 0) {
    list.innerHTML = '<li class="np-empty">All clear.</li>';
  }
  updateNotifBadge();
})();

function toggleOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('open')) closeOverlay(id);
  else openOverlay(id);
}

function updateNotifBadge() {
  const btn = document.getElementById('notifIconBtn');
  if (!btn) return;
  const list = document.getElementById('notificationsList');
  const count = list ? list.querySelectorAll('.note').length : 0;
  let badge = btn.querySelector('.icon-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'icon-badge';
      btn.appendChild(badge);
    }
    badge.textContent = String(count);
  } else if (badge) {
    badge.remove();
  }
}

function clearDismissedNotifications() {
  try { localStorage.removeItem(DISMISSED_NOTES_KEY); } catch {}
  // Quickest way to re-render: reload. The full set is computed server-side.
  location.reload();
}

// Lazy-fetch version + update-available pill, populate the footer line.
// Pill sits IN FRONT of the version so a fresh release catches the eye
// before the v-number; pulses for 5s on first appearance, then settles.
(async function loadVersionInfo() {
  const el = document.getElementById('version-line');
  if (!el) return;
  try {
    const r = await fetch('/api/version');
    if (!r.ok) return;
    const v = await r.json();
    let prefix = '';
    let suffix = '';
    if (v.update?.hasUpdate && v.update.latestVersion) {
      const href = v.update.latestHtmlUrl || '#';
      prefix = '<a href="' + href + '" target="_blank" rel="noopener"><span class="pill pill-yellow update-pulse">Update available: ' + v.update.latestVersion + '</span></a> ';
      suffix = ' <button class="primary" style="margin-left:.5rem; padding:.15rem .6rem; font-size:.8rem" onclick="doSelfUpdate()">Update now</button>';
    } else if (v.update?.latestVersion) {
      suffix = ' · <span class="muted">latest: ' + v.update.latestVersion + '</span>';
    } else if (v.update?.error?.hint) {
      // Update check failed (likely private-source-repo + no UPDATE_TOKEN).
      // Surface the hint so the operator knows why no pill is showing.
      suffix = ' · <span class="muted" title="' + v.update.error.hint.replace(/"/g, '&quot;') + '">(update check unavailable)</span>';
    }
    let html = prefix + 'v' + (v.version || '?');
    if (v.commit) html += ' · ' + v.commit.slice(0, 7);
    html += suffix;
    el.innerHTML = html;
    // Strip the pulse class after ~5s so it doesn't loop forever.
    setTimeout(() => el.querySelectorAll('.update-pulse').forEach(n => n.classList.remove('update-pulse')), 5000);

    // Add an 'update-available' notification into the header bell, if any.
    if (v.update?.hasUpdate && v.update.latestVersion) {
      addClientNotification({
        id: 'update-available-' + v.update.latestVersion,
        tier: 'info',
        title: 'Update available — ' + v.update.latestVersion,
        body: 'Current ' + (v.version || '?') + '. Click to deploy.',
        actionHandler: 'doSelfUpdate',
        actionLabel: 'Update now',
      });
    }
  } catch {}
})();

// Client-side notification injection. Used for signals that aren't known
// at server-render time (update-available, anything fetched after load).
function addClientNotification({ id, tier, title, body, actionHandler, actionLabel }) {
  const list = document.getElementById('notificationsList');
  if (!list) return;
  const dismissed = getDismissedNotes();
  if (dismissed.has(id)) return;
  // De-dupe by id.
  if (list.querySelector('[data-note-id="' + CSS.escape(id) + '"]')) return;
  // Remove the "All clear" placeholder if present.
  const empty = list.querySelector('.np-empty');
  if (empty) empty.remove();

  const escape = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const actionHtml = actionHandler
    ? '<button type="button" class="note-action" data-handler="' + escape(actionHandler) + '">' + escape(actionLabel || 'Action') + '</button>'
    : '';
  const li = document.createElement('li');
  li.className = 'note note-tier-' + tier;
  li.setAttribute('data-note-id', id);
  li.innerHTML =
    '<div class="note-body">' +
      '<div class="note-title">' + escape(title) + '</div>' +
      '<div class="note-text">' + escape(body) + '</div>' +
      actionHtml +
    '</div>' +
    '<button type="button" class="note-dismiss" aria-label="Dismiss" data-dismiss="' + escape(id) + '">×</button>';
  list.insertBefore(li, list.firstChild);
  updateNotifBadge();
}
`;
