// Per-VM cards + fleet controls.

import { escapeHtml, pill, statusDot } from '../common.js';

export function renderFleet({ fleet, total, aliveCount, sleepingCount, byModel, agents, reconcile }) {
  const cards = (agents || []).map(renderAgentCard).join('') || '<p class="empty">No agents yet. Open a labeled issue in your repo to trigger one.</p>';

  return `
<h2>Flow 2 — Fleet</h2>
<div class="spread" style="margin-bottom:.5rem">
  <span class="muted">
    Total ${total}
    · alive ${aliveCount}/${fleet.maxAgentsTotal}
    · sleeping ${sleepingCount}
    · haiku ${(byModel.haiku || 0)}/${fleet.maxAgentsPerModel.haiku}
    · sonnet ${(byModel.sonnet || 0)}/${fleet.maxAgentsPerModel.sonnet}
    · opus ${(byModel.opus || 0)}/${fleet.maxAgentsPerModel.opus}
  </span>
  <div class="row">
    <button onclick="fleetAction('wake-all')">Wake all</button>
    <button onclick="fleetAction('sleep-all')">Sleep all</button>
    <button class="primary" onclick="promptSpin()">+ Force-create</button>
  </div>
</div>
${renderReconcile(reconcile)}
<div class="grid">${cards}</div>
`;
}

function renderReconcile(reconcile) {
  const lr = reconcile?.lastRun;
  const assigns = reconcile?.assignments || [];
  if (!lr) {
    return `<div class="card"><div class="spread"><span class="muted">Orchestrator: no reconcile run yet.</span><button onclick="doReconcile()">Reconcile now</button></div></div>`;
  }
  const when = lr.at ? new Date(lr.at).toLocaleTimeString() : '?';
  const unclaimed = (lr.unclaimed || []).map(i => `#${i.issue}${i.onboarding ? ' (onboarding)' : ''}·${i.model}`).join(', ') || 'none';
  const liveAssigns = assigns.map(a => `#${escapeHtml(String(a.issue))}→${escapeHtml(a.vm)}`).join(', ') || 'none';
  const errLine = lr.error ? `<div class="err">reconcile error: ${escapeHtml(lr.error)}</div>` : '';
  return `
<div class="card">
  <div class="spread">
    <strong>Orchestrator</strong>
    <div class="row"><span class="muted">last run ${escapeHtml(when)}</span><button onclick="doReconcile()">Reconcile now</button></div>
  </div>
  ${errLine}
  <div class="muted" style="margin-top:.35rem; font-size:.88rem">
    Unclaimed issues: ${escapeHtml(unclaimed)}<br>
    Alive ${lr.aliveCount ?? '?'} · free ${lr.freeCount ?? '?'} · active assignments: ${escapeHtml(liveAssigns)}
    ${lr.needCapacity && Object.keys(lr.needCapacity).length ? `<br>Waiting on capacity: ${escapeHtml(JSON.stringify(lr.needCapacity))}` : ''}
  </div>
</div>`;
}

function renderAgentCard(a) {
  const stateClass = a.powerState === 'running' ? 'green'
    : a.powerState === 'starting' ? 'running'
    : (a.powerState === 'deallocated' || a.powerState === 'stopped') ? 'unknown'
    : 'yellow';
  const activity = a.activity;
  const summary = activity?.summary || activity?.state || '<em class="muted">no live status</em>';
  const issue = activity?.issue ? `#${escapeHtml(activity.issue)} · ` : '';
  const updated = activity?.updatedAt ? new Date(activity.updatedAt).toLocaleTimeString() : '';
  const assignLine = a.assignment
    ? `<div class="muted" style="font-size:.82rem">assigned #${escapeHtml(String(a.assignment.issue))}${a.assignment.onboarding ? ' (onboarding)' : ''} — awaiting agent pickup</div>`
    : '';

  const canForceSync = ['running', 'starting'].includes(a.powerState);

  return `
<div class="card" style="position:relative">
  <div class="spread" style="margin-bottom:.25rem">
    <strong>${escapeHtml(a.vmName)}</strong>
    <div class="row" style="gap:.25rem">
      ${pill(stateClass, a.powerState)}
      ${pill('unknown', a.model)}
    </div>
  </div>
  <div style="margin:.25rem 0; min-height:1.5rem">
    ${activity ? `<span class="muted">${escapeHtml(issue)}</span>${escapeHtml(summary)}` : '<span class="empty">awaiting status</span>'}
    ${updated ? `<span class="muted" style="font-size:.8rem"> · ${escapeHtml(updated)}</span>` : ''}
    ${assignLine}
  </div>
  <div class="row" style="gap:.25rem; flex-wrap:wrap">
    <button onclick="showLog('${escapeHtml(a.vmName)}')">Log</button>
    <button onclick="showTimeline('${escapeHtml(a.vmName)}')">Timeline</button>
    <button onclick="vmAction('${escapeHtml(a.vmName)}','force-sync')" ${canForceSync ? '' : 'disabled'}>Force sync</button>
    ${a.powerState === 'running'
      ? `<button onclick="vmAction('${escapeHtml(a.vmName)}','sleep')">Sleep</button>`
      : `<button onclick="vmAction('${escapeHtml(a.vmName)}','wake')">Wake</button>`}
    <button class="danger" onclick="vmAction('${escapeHtml(a.vmName)}','delete')">Delete</button>
  </div>
</div>`;
}
