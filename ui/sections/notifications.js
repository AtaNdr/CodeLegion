// Computes the notifications surfaced in the bell-icon panel.
//
// All sources derive from data the page already has — no new backend
// round-trips. The "update available" notification is added client-side
// after /api/version resolves (see ui/script.js).
//
// Each notification has:
//   { id, tier: 'action'|'warn'|'info', title, body, action?: { label, handler?, target? } }

const TIER_ORDER = { action: 0, warn: 1, info: 2 };

export function computeNotifications({ phase1, fleet }) {
  const notes = [];

  // 1. Setup incomplete — only when at least one required check is red.
  //    Yellow alone (e.g., branch protection skipped) doesn't trigger.
  if (phase1?.summary && !phase1.summary.allDone && phase1.summary.red > 0) {
    const s = phase1.summary;
    notes.push({
      id: 'setup-incomplete',
      tier: 'action',
      title: 'Infrastructure setup incomplete',
      body: `${s.red} red · ${s.yellow} warn · ${s.unknown} unrun. Open Settings to walk the wizard.`,
      action: { label: 'Open setup', target: 'setupModal' },
    });
  }

  // 2. Fleet paused — reconcile is halted; existing agents deallocated.
  if (fleet?.reconcile?.pause?.paused) {
    const since = fleet.reconcile.pause.updatedAt;
    notes.push({
      id: 'fleet-paused',
      tier: 'action',
      title: 'Fleet paused',
      body: 'Reconcile is halted. Click to resume.' + (since ? ` Since ${new Date(since).toLocaleString()}.` : ''),
      action: { label: 'Start fleet', handler: 'doResumeFleet' },
    });
  }

  // 3. Recent VM-create failures — last 3, newest first.
  const fails = (fleet?.reconcile?.vmOutcomes || []).filter(o => o.status === 'failed').slice(0, 3);
  for (const f of fails) {
    notes.push({
      id: `vm-fail-${f.vmName}`,
      tier: 'warn',
      title: `VM create failed — ${f.vmName}`,
      body: (f.error || 'no error message captured').slice(0, 180),
    });
  }

  // 4. Agents stuck in an explicit error state. auth-error and config-error
  //    are both deal-breakers — the VM can't do useful work until the
  //    operator intervenes.
  for (const a of fleet?.agents || []) {
    const st = a.activity?.state;
    if (st === 'auth-error' || st === 'config-error') {
      const name = a.activity?.agentName ? `${a.activity.agentEmoji || ''} ${a.activity.agentName}` : a.vmName;
      notes.push({
        id: `agent-err-${a.vmName}-${st}`,
        tier: 'warn',
        title: `${name.trim()} — ${st}`,
        body: a.activity?.summary || 'Check the VM log; usually a token or config drift.',
      });
    }
  }

  // 5. Running agent that has never polled /agent/next-task. Almost always
  //    a stale agent (old script, before self-update) or REPORT_TOKEN drift.
  for (const a of fleet?.agents || []) {
    if (a.powerState === 'running' && !a.pollTelemetry) {
      notes.push({
        id: `agent-stale-${a.vmName}`,
        tier: 'warn',
        title: `Agent hasn't polled — ${a.vmName}`,
        body: 'Likely stale agent code or REPORT_TOKEN mismatch. Delete the VM (not Sleep) and let reconcile spin a fresh one.',
      });
    }
  }

  // Stable sort by tier (action first), then by id for stable order across
  // refreshes so dismissed-by-id works reliably.
  notes.sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || a.id.localeCompare(b.id));
  return notes;
}

// HTML for the notifications popover. Items are rendered into <ol> with a
// fixed structure; the inline script handles open/close and dismissal.
export function renderNotificationsPanel(notes) {
  const items = (notes || []).map((n) => {
    const tierClass = `note-tier-${n.tier}`;
    const actionAttr = n.action?.handler
      ? `data-handler="${escape(n.action.handler)}"`
      : n.action?.target
        ? `data-target="${escape(n.action.target)}"`
        : '';
    const actionBtn = n.action
      ? `<button type="button" class="note-action" ${actionAttr}>${escape(n.action.label)}</button>`
      : '';
    return `
      <li class="note ${tierClass}" data-note-id="${escape(n.id)}">
        <div class="note-body">
          <div class="note-title">${escape(n.title)}</div>
          <div class="note-text">${escape(n.body)}</div>
          ${actionBtn}
        </div>
        <button type="button" class="note-dismiss" aria-label="Dismiss" data-dismiss="${escape(n.id)}">×</button>
      </li>`;
  }).join('');

  return `
    <div class="notifications-panel" id="notificationsPanel" hidden>
      <div class="np-header">
        <strong>Notifications</strong>
        <button type="button" class="np-close" aria-label="Close" onclick="closeOverlay('notificationsPanel')">×</button>
      </div>
      <ol class="np-list" id="notificationsList">${items || '<li class="np-empty">All clear.</li>'}</ol>
      <div class="np-footer">
        <button type="button" class="link-btn" onclick="clearDismissedNotifications()">Show dismissed</button>
      </div>
    </div>`;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
