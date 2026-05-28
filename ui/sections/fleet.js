// Per-VM cards + fleet controls.

import { escapeHtml, pill, statusDot } from '../common.js';

export function renderFleet({ fleet, total, aliveCount, sleepingCount, byModel, agents, reconcile }) {
  const cards = (agents || []).map(renderAgentCard).join('') || '<p class="empty">No agents yet. Open a labeled issue in your repo to trigger one.</p>';
  const paused = reconcile?.pause?.paused === true;
  const pauseBtn = paused
    ? `<button class="primary" onclick="doResumeFleet()">▶ Start fleet</button>`
    : `<button class="danger" onclick="doPauseFleet()">⏸ Stop fleet</button>`;
  const pausedBanner = paused
    ? `<div class="card" style="border-left:3px solid var(--warn, #c79100); background:color-mix(in srgb, var(--warn, #c79100) 8%, transparent); margin-bottom:.5rem">
         <strong>Fleet paused.</strong> Reconcile is halted and no new agents will spin or wake. Existing agents were deallocated. Click <em>Start fleet</em> to resume.
         ${reconcile?.pause?.updatedAt ? `<span class="muted" style="margin-left:.5rem; font-size:.85rem">since ${escapeHtml(new Date(reconcile.pause.updatedAt).toLocaleString())}</span>` : ''}
       </div>`
    : '';

  return `
<h2>Fleet</h2>
${pausedBanner}
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
    ${pauseBtn}
    <button onclick="fleetAction('wake-all')" ${paused ? 'disabled title="Fleet is paused"' : ''}>Wake all</button>
    <button onclick="fleetAction('sleep-all')">Sleep all</button>
    <button class="primary" onclick="promptSpin()" ${paused ? 'disabled title="Fleet is paused"' : ''}>+ Force-create</button>
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
  const acts = lr.capacityActions || [];
  const actionsLine = acts.length
    ? `<br>Capacity actions: ${acts.map(a => {
        const tag = a.action === 'spinning' || a.action === 'waking' ? 'ok'
          : a.action === 'skipped' ? 'muted' : 'err';
        const detail = a.error ? ` (${a.error.slice(0, 80)})`
          : a.vmName ? ` ${a.vmName}` : a.reason ? ` (${a.reason})` : '';
        return `<span class="${tag === 'err' ? 'err' : tag === 'ok' ? 'ok' : 'muted'}">${escapeHtml(a.model)}: ${escapeHtml(a.action)}${escapeHtml(detail)}</span>`;
      }).join(' · ')}`
    : '';
  // Show recent failed VM creations prominently — these are usually the
  // root cause when reconcile keeps spinning but no VM appears.
  const outcomes = reconcile?.vmOutcomes || [];
  const failures = outcomes.filter(o => o.status === 'failed').slice(0, 3);
  const failuresBlock = failures.length
    ? `<div class="err" style="margin-top:.5rem; font-size:.85rem"><strong>Recent VM creation failures:</strong>${failures.map(f =>
        `<div style="margin-top:.2rem">· ${escapeHtml(new Date(f.at).toLocaleTimeString())} · ${escapeHtml(f.vmName)} (${escapeHtml(f.model)}): ${escapeHtml((f.error || '').slice(0, 280))}</div>`
      ).join('')}</div>`
    : '';
  return `
<div class="card">
  <div class="spread">
    <strong>Orchestrator</strong>
    <div class="row"><span class="muted">last run ${escapeHtml(when)}${reconcile?.historyCount ? ' · ' + reconcile.historyCount + ' runs kept' : ''}</span><button onclick="showReconcileHistory()">History</button><button onclick="doReconcile()">Reconcile now</button></div>
  </div>
  ${errLine}
  <div class="muted" style="margin-top:.35rem; font-size:.88rem">
    Unclaimed issues: ${escapeHtml(unclaimed)}<br>
    Alive ${lr.aliveCount ?? '?'} · free ${lr.freeCount ?? '?'} · active assignments: ${escapeHtml(liveAssigns)}
    ${lr.needCapacity && Object.keys(lr.needCapacity).length ? `<br>Waiting on capacity: ${escapeHtml(JSON.stringify(lr.needCapacity))}` : ''}
    ${actionsLine}
  </div>
  ${failuresBlock}
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
  // Polling telemetry — does the agent actually ask the controller for tasks?
  let pollLine = '';
  if (a.pollTelemetry) {
    const t = a.pollTelemetry;
    const age = t.ageSeconds == null ? '?' : t.ageSeconds + 's';
    pollLine = `<div class="muted" style="font-size:.78rem">polled ${escapeHtml(age)} ago · ${escapeHtml(t.lastResult || '?')} · ${t.pollCount || 0} total</div>`;
  } else if (a.powerState === 'running') {
    pollLine = '<div class="warn" style="font-size:.78rem">never polled /agent/next-task — likely stale agent code or token mismatch</div>';
  }

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
    ${pollLine}
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
