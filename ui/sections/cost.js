// Cost summary + recent tasks table.

import { escapeHtml, issueLink, currentRepo } from '../common.js';
import { pricingFreshness } from '../../anthropic/pricing.js';

const formatDollars = (n) => n < 0.01 ? '$' + n.toFixed(4) : n < 1 ? '$' + n.toFixed(3) : '$' + n.toFixed(2);
const formatTokens = (n) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
const formatDuration = (s) => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

export function renderCost({ totals, recent }) {
  const freshness = pricingFreshness();
  const stalePill = freshness.fresh
    ? ''
    : `<span class="pill pill-yellow">Pricing may be stale — ${freshness.ageDays || '?'} days old</span>`;

  const repo = currentRepo();
  const rows = (recent || []).map(r => `
    <tr>
      <td>${escapeHtml(new Date(r.timestamp).toLocaleString())}</td>
      <td>${escapeHtml(r.agent || '?')}</td>
      <td>${escapeHtml(r.model || '?')}</td>
      <td>${r.kind === 'explorer' ? '<em>explorer</em>' : (r.issue ? issueLink(r.issue, repo) : '?')}</td>
      <td>${escapeHtml(formatTokens((r.input || 0) + (r.output || 0) + (r.cacheCreate || 0) + (r.cacheRead || 0)))}</td>
      <td>${escapeHtml(formatDuration(r.durationSeconds || 0))}</td>
      <td>${escapeHtml(formatDollars(r.cost || 0))}</td>
    </tr>`).join('');

  const by = totals.byModelMonth || {};

  return `
<h2>Cost ${stalePill}</h2>
<div class="grid">
  <div class="card">
    <h3>Today</h3>
    <div style="font-size:1.4rem; font-weight:600">${escapeHtml(formatDollars(totals.today.cost || 0))}</div>
    <div class="muted">${escapeHtml(formatTokens(totals.today.tokens || 0))} tokens · ${totals.today.count || 0} tasks</div>
  </div>
  <div class="card">
    <h3>This month</h3>
    <div style="font-size:1.4rem; font-weight:600">${escapeHtml(formatDollars(totals.month.cost || 0))}</div>
    <div class="muted">${escapeHtml(formatTokens(totals.month.tokens || 0))} tokens · ${totals.month.count || 0} tasks</div>
  </div>
  <div class="card">
    <h3>By model · month</h3>
    <div>haiku: ${escapeHtml(formatDollars(by.haiku?.cost || 0))}</div>
    <div>sonnet: ${escapeHtml(formatDollars(by.sonnet?.cost || 0))}</div>
    <div>opus: ${escapeHtml(formatDollars(by.opus?.cost || 0))}</div>
  </div>
</div>

<h3 style="margin-top:1rem">Recent tasks</h3>
${rows.length === 0 ? '<p class="empty">No tasks yet.</p>' : `
<div class="card" style="padding:0; overflow:hidden">
<table>
  <thead><tr><th>When</th><th>Agent</th><th>Model</th><th>Issue</th><th>Tokens</th><th>Duration</th><th>Cost</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>
`}
`;
}
