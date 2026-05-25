// Inline browser-side script for the status page.
// Exported as a string so render.js can splice it into the HTML.

export const INLINE_SCRIPT = `
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
  if (!confirm('Run remediation for ' + id + '?')) return;
  const btn = document.querySelector(\`[data-fix="\${id}"]\`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try { await postJson('/setup/action/' + encodeURIComponent(id)); }
  catch (e) { alert('Fix failed: ' + e.message); }
  finally { location.reload(); }
}

const UPLOAD_CONFIGS = {
  anthropic: { title: 'Upload Anthropic API key', label: 'sk-ant-... key', endpoint: '/setup/upload-anthropic-key', key: 'apiKey' },
  github:    { title: 'Upload GitHub App private key (PEM)', label: 'Paste the contents of your .pem file', endpoint: '/setup/upload-gh-key', key: 'privateKey' },
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

// Fleet (Phase 4+) helpers
async function vmAction(name, action) {
  if (action === 'delete' && !confirm('Delete VM ' + name + '? Disk and state are lost.')) return;
  try {
    if (action === 'delete') {
      await fetch('/admin/vm/' + encodeURIComponent(name), { method: 'DELETE' });
    } else {
      await postJson('/admin/vm/' + encodeURIComponent(name) + '/' + action);
    }
  } catch (e) { alert(e.message); }
  finally { location.reload(); }
}
async function fleetAction(action) {
  try { await postJson('/admin/' + action); }
  catch (e) { alert(e.message); }
  finally { location.reload(); }
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
  if (!dlg) { alert(text.slice(-4000)); return; }
  document.getElementById('timeline-title').textContent = 'Raw log · ' + vmName;
  document.getElementById('timeline-body').textContent = text.slice(-8000) || '(empty)';
  dlg.showModal();
}
async function promptSpin() {
  const model = prompt('Model (haiku/sonnet/opus)?', 'sonnet');
  if (!model) return;
  try {
    const r = await fetch('/admin/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    location.reload();
  } catch (e) { alert(e.message); }
}

async function doSelfUpdate() {
  if (!confirm('Pull latest release and restart? The Web App will be unavailable for ~60s.')) return;
  try { await postJson('/admin/self-update'); alert('Update triggered. Refresh in ~60s.'); }
  catch (e) { alert('Self-update failed: ' + e.message); }
}
`;
