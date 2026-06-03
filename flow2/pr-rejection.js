// Handle a PR review with state == "changes_requested" by re-queueing the
// linked issue for an agent.
//
// Previously this was done by `repo-template/.github/workflows/
// agent-pr-rejection.yml`, which required the GitHub App to have the
// `workflows: write` permission AND the user to keep the YAML present in
// their repo. Both were silent failure modes — no workflow file, or no
// permission to inject one, and the feedback loop was dead.
//
// Doing it in the controller removes both dependencies. The GitHub App is
// already subscribed to pull_request_review events (per SETUP.md), and the
// controller already has issues:write to relabel.

import { ghFetch } from '../github/app.js';
import { reconcile } from './reconcile.js';

// Labels that look like a claim (`agent:<name>`) but aren't a claim per
// the rest of the system. Don't strip these.
const CLAIM_EXCEPTIONS = new Set([
  'agent:onboarding', 'agent:needs-revision', 'agent:blocked',
  'agent:do-not-pick', 'agent:approved',
]);

// PR-body issue-linking keywords GitHub honours. Match the same set so the
// re-queue fires for any closure phrase a reviewer might have used.
function extractIssueNumber(body) {
  if (!body) return null;
  const m = String(body).match(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i);
  return m ? Number(m[1]) : null;
}

export async function handlePullRequestReview(payload) {
  // Only act on "changes requested". Approvals and plain comments leave
  // the queue alone.
  if (payload?.review?.state !== 'changes_requested') return { skipped: 'not changes_requested' };

  const pr = payload.pull_request;
  if (!pr) return { skipped: 'no pull_request in payload' };

  const issueNum = extractIssueNumber(pr.body);
  if (!issueNum) return { skipped: 'no Closes #N in PR body' };

  const owner = payload.repository?.owner?.login || process.env.GH_REPO_OWNER;
  const repo = payload.repository?.name || process.env.GH_REPO_NAME;
  if (!owner || !repo) return { skipped: 'no repo context' };

  // Pull current labels, drop any agent-claim labels, then add the two
  // signals reconcile + the agent prompt look for.
  let issue;
  try {
    const r = await ghFetch(`/repos/${owner}/${repo}/issues/${issueNum}`);
    if (!r.ok) return { error: `GET issue #${issueNum}: ${r.status}` };
    issue = await r.json();
  } catch (e) {
    return { error: `GET issue #${issueNum} threw: ${e.message}` };
  }

  const removed = [];
  for (const l of issue.labels || []) {
    const name = typeof l === 'string' ? l : l.name;
    if (!name?.startsWith('agent:')) continue;
    if (CLAIM_EXCEPTIONS.has(name)) continue;
    try {
      const r = await ghFetch(`/repos/${owner}/${repo}/issues/${issueNum}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (r.ok) removed.push(name);
      else console.warn(`[pr-rejection] could not remove ${name} from #${issueNum}: ${r.status}`);
    } catch (e) {
      console.warn(`[pr-rejection] remove ${name} threw:`, e.message);
    }
  }

  try {
    await ghFetch(`/repos/${owner}/${repo}/issues/${issueNum}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: ['agent-ready', 'agent:needs-revision'] }),
    });
  } catch (e) {
    console.warn(`[pr-rejection] add labels threw:`, e.message);
  }

  // Leave a marker on the issue so the next agent (and a human scanning
  // the thread) can see what triggered the re-queue.
  try {
    await ghFetch(`/repos/${owner}/${repo}/issues/${issueNum}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: `🔁 PR #${pr.number} had changes requested by @${payload.review.user?.login || 'reviewer'}. Re-queued for an agent to address review feedback.`,
      }),
    });
  } catch (e) {
    console.warn(`[pr-rejection] comment threw:`, e.message);
  }

  // Kick reconcile so the dispatch happens immediately rather than at
  // the next 45-second tick.
  reconcile().catch((e) => console.error('[pr-rejection→reconcile]', e.message));

  console.log(`[pr-rejection] #${issueNum} re-queued from PR #${pr.number} review (removed: ${removed.join(',') || 'none'})`);
  return { issue: issueNum, pr: pr.number, removed };
}
