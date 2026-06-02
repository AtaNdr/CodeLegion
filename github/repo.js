// GitHub Contents API helpers — read, write, delete files in the target repo.
//
// Phase 2 surface: read-only probes (getRepoFile).
// Phase 3 surface: injectFiles / cleanFiles / setLabels / setBranchProtection.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ghFetch } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '..', 'repo-template');

// Lists mirror v1's install-into-repo.sh:35-59. Some files are contracts we
// must keep current; some are project-accumulating and must not be clobbered.
export const ALWAYS_OVERWRITE = [
  'CLAUDE.md',
  'COMMENT_STYLE.md',
  'DESIGN_DEFAULTS.md',
  'DO_NOT_TOUCH.md',
  '.github/ISSUE_TEMPLATE/agent-task.md',
  '.github/ISSUE_TEMPLATE/free-form-request.md',
  '.github/labels.yml',
  '.github/workflows/agent-pr-rejection.yml',
];

export const CREATE_IF_MISSING = [
  'CONTEXT.md',
  'ARCHITECTURE.md',
  'DESIGN.md',
  'KNOWN_ISSUES.md',
  'LESSONS.md',
  '.github/CODEOWNERS',
];

const owner = () => process.env.GH_REPO_OWNER;
const repo = () => process.env.GH_REPO_NAME;

function repoPath(filePath) {
  const o = owner();
  const r = repo();
  if (!o || !r) throw new Error('GH_REPO_OWNER / GH_REPO_NAME not set');
  return `/repos/${o}/${r}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;
}

export async function getRepoFile(filePath) {
  const resp = await ghFetch(repoPath(filePath));
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GET ${filePath} failed: ${resp.status}`);
  return resp.json();
}

// ---- Phase 3+ surface ---------------------------------------------------

function readTemplateFile(filePath) {
  const full = path.join(TEMPLATE_DIR, filePath);
  if (!fs.existsSync(full)) throw new Error(`template file missing: ${filePath}`);
  return fs.readFileSync(full);
}

async function putFile(filePath, content, { sha, message }) {
  const body = {
    message,
    content: Buffer.isBuffer(content) ? content.toString('base64') : Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;
  const resp = await ghFetch(repoPath(filePath), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`PUT ${filePath} failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function deleteFile(filePath, { sha, message }) {
  const resp = await ghFetch(repoPath(filePath), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DELETE ${filePath} failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function injectFiles({ dryRun = false } = {}) {
  const results = [];
  for (const filePath of [...ALWAYS_OVERWRITE, ...CREATE_IF_MISSING]) {
    const overwrite = ALWAYS_OVERWRITE.includes(filePath);
    let current;
    try { current = await getRepoFile(filePath); } catch (e) { current = null; }

    if (!overwrite && current) {
      results.push({ path: filePath, action: 'skipped', reason: 'exists' });
      continue;
    }
    if (overwrite && current && contentMatches(current, filePath)) {
      results.push({ path: filePath, action: 'unchanged' });
      continue;
    }

    if (dryRun) {
      results.push({ path: filePath, action: current ? 'would-update' : 'would-create' });
      continue;
    }

    let content;
    try {
      content = readTemplateFile(filePath);
    } catch (e) {
      results.push({ path: filePath, action: 'error', error: e.message });
      continue;
    }

    try {
      await putFile(filePath, content, {
        sha: current?.sha,
        message: current ? `codelegion: update ${filePath}` : `codelegion: add ${filePath}`,
      });
      results.push({ path: filePath, action: current ? 'updated' : 'created' });
    } catch (e) {
      results.push({ path: filePath, action: 'error', error: e.message });
    }

    await sleep(200);  // throttle to stay well under Contents API secondary limits
  }
  return results;
}

function contentMatches(current, filePath) {
  try {
    const remoteB64 = (current.content || '').replace(/\n/g, '');
    const local = readTemplateFile(filePath).toString('base64');
    return remoteB64 === local;
  } catch {
    return false;
  }
}

export async function cleanFiles({ dryRun = false } = {}) {
  const results = [];
  for (const filePath of ALWAYS_OVERWRITE) {
    let current;
    try { current = await getRepoFile(filePath); } catch (e) { current = null; }
    if (!current) { results.push({ path: filePath, action: 'absent' }); continue; }
    if (dryRun) { results.push({ path: filePath, action: 'would-delete' }); continue; }
    try {
      await deleteFile(filePath, {
        sha: current.sha,
        message: `codelegion: remove ${filePath}`,
      });
      results.push({ path: filePath, action: 'deleted' });
    } catch (e) {
      results.push({ path: filePath, action: 'error', error: e.message });
    }
    await sleep(200);
  }
  return results;
}

// ---- Labels --------------------------------------------------------------

export const REQUIRED_LABELS = [
  { name: 'agent-ready', color: '0e8a16', description: 'Ready for an agent to pick up' },
  { name: 'agent:blocked', color: 'b60205', description: 'Agent blocked; needs human input' },
  { name: 'agent:do-not-pick', color: '6a737d', description: 'Agents should not pick this up' },
  { name: 'agent:needs-revision', color: 'fbca04', description: 'Agent must address review comments' },
  { name: 'agent:approved', color: '1d76db', description: 'Triage proposal approved; execute' },
  { name: 'agent:onboarding', color: '5319e7', description: 'Repo onboarding task — context files' },
  { name: 'model:haiku', color: 'c5def5', description: 'Run on Claude Haiku' },
  { name: 'model:sonnet', color: 'bfd4f2', description: 'Run on Claude Sonnet' },
  { name: 'model:opus', color: 'd4c5f9', description: 'Run on Claude Opus' },
  { name: 'triage:proposed', color: 'fef2c0', description: 'Agent proposed a triage; awaiting human' },
  { name: 'epic', color: '3e4b9e', description: 'Parent issue split into child tasks' },
];

export async function syncLabels() {
  const o = owner();
  const r = repo();
  const out = [];
  for (const lbl of REQUIRED_LABELS) {
    const resp = await ghFetch(`/repos/${o}/${r}/labels/${encodeURIComponent(lbl.name)}`);
    if (resp.status === 404) {
      const createResp = await ghFetch(`/repos/${o}/${r}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lbl),
      });
      out.push({ name: lbl.name, action: createResp.ok ? 'created' : `error:${createResp.status}` });
    } else if (resp.ok) {
      out.push({ name: lbl.name, action: 'exists' });
    } else {
      out.push({ name: lbl.name, action: `error:${resp.status}` });
    }
    await sleep(150);
  }
  return out;
}

// ---- Branch protection ---------------------------------------------------

export async function setBranchProtection(branch = 'main') {
  const o = owner();
  const r = repo();
  const body = {
    required_status_checks: null,
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: false,
      require_code_owner_reviews: true,
    },
    restrictions: null,
  };
  const resp = await ghFetch(`/repos/${o}/${r}/branches/${branch}/protection`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.message || text;
    console.error(`[branch-protection] PUT failed ${resp.status}:`, text);
    if (resp.status === 403 && /upgrade to github pro|make this repository public/i.test(msg)) {
      const err = new Error('Branch protection on private repos requires a paid GitHub plan (Pro or higher). Either upgrade, make the repo public, or skip this check — it has no effect on the rest of the fleet.');
      err.code = 'GH_BRANCH_PROTECTION_UNAVAILABLE';
      throw err;
    }
    if (resp.status === 403 && /resource not accessible by integration/i.test(msg)) {
      const err = new Error(adminPermError() + `\n\nGitHub raw message: "${msg}"`);
      err.code = 'GH_APP_MISSING_ADMIN';
      throw err;
    }
    const err = new Error(`Branch protection PUT failed (${resp.status}): ${msg}`);
    err.raw = text;
    err.body = body;
    throw err;
  }
  return resp.json();
}

function adminPermError() {
  return 'GitHub App is missing the "Administration: Read & write" permission on this installation. Three things to check:\n' +
    '1. App settings → Permissions & events → Administration set to Read & write → Save changes.\n' +
    '2. github.com/settings/installations (or .../organizations/<org>/settings/installations) → Configure your App → click the yellow "Review and accept" banner at the top.\n' +
    '3. If installed on an organization, an org owner must approve the new permissions — not just you. They\'ll see the same banner.';
}

// ---- Onboarding issue (controller-orchestrated) --------------------------
// The controller creates the onboarding issue deterministically (it has
// reliable GitHub API access), instead of relying on the agent's bash loop
// to self-create it. The agent then just claims and executes.

export const ONBOARDING_LABEL = 'agent:onboarding';
export const ONBOARDING_TITLE = 'Onboard CodeLegion: write CONTEXT.md, ARCHITECTURE.md, DESIGN.md';

const ONBOARDING_BODY = `## What this is

The three agent context files (\`CONTEXT.md\`, \`ARCHITECTURE.md\`, \`DESIGN.md\`) are missing or still contain the \`<!-- explorer: empty -->\` placeholder. **No agent can do regular work until these are filled in — all regular work is halted until this issue is closed.**

You are the agent responsible for this. Do not block or unclaim it. Do NOT apply CLAUDE.md's "do not start regular work" rule to yourself — that rule protects regular tasks; THIS task is the one that fixes the gate.

## Your task

Read every source file in the repo — don't skim. Read \`package.json\` / \`go.mod\` / \`requirements.txt\` / equivalent, the directory tree, and any README. Then write these three files from scratch, replacing the \`<!-- explorer: empty -->\` marker in each with real, thorough content.

### CONTEXT.md — how to work in this repo
- One-paragraph description of what the project does and who it's for
- Stack: language(s), framework(s), database, test framework, package manager — with versions if visible
- Copy-pasteable commands for install / run / test / lint / format / type-check — verified to work
- Key directories — one line each
- Conventions, gotchas, how to run locally end-to-end

### ARCHITECTURE.md — the *why*, not just the *what*
- How the major pieces communicate (data flow, API boundaries, events)
- Why the top-level split exists; external integrations
- Anything that looks odd but is intentional. Mark uncertainty with "OPEN QUESTION: ..."

### DESIGN.md — the UI contract
- If UI: frameworks, tokens (colours/spacing/type/breakpoints), patterns to preserve, inconsistencies to resolve, a proposed contract, open questions
- If no UI: say so in one sentence and note any constraints

## Acceptance criteria

- [ ] \`CONTEXT.md\` has no \`<!-- explorer: empty -->\` marker and contains real, project-specific content
- [ ] \`ARCHITECTURE.md\` has no marker and explains the *why*
- [ ] \`DESIGN.md\` has no marker and documents the UI contract or states there's no UI
- [ ] A PR titled "Initial CodeLegion context" is open, labelled \`agent:do-not-pick\`

## Steps

1. Create a branch and push it
2. Read the entire codebase before writing anything
3. Write all three files — real content, no placeholders
4. Open the PR titled "Initial CodeLegion context"; add label \`agent:do-not-pick\`
5. Comment on this issue with the PR link

Be thorough — every future agent depends on these files.`;

// Returns every open onboarding issue, oldest first. The label-filtered
// /issues query (?labels=agent:onboarding) lags ~30–60s after a label is
// added — race window where reconcile sees "no onboarding issue" right
// after Flow 1 created one and creates a duplicate. We scan the full
// recent-open-issues list instead (that endpoint is real-time fresh) and
// match by label OR exact title — title catches the case where the label
// itself isn't visible yet.
export async function findAllOpenOnboardingIssues() {
  const o = owner();
  const r = repo();
  const resp = await ghFetch(`/repos/${o}/${r}/issues?state=open&per_page=100&sort=created&direction=asc`);
  if (!resp.ok) return [];
  const arr = await resp.json();
  const out = [];
  for (const it of arr) {
    if (it.pull_request) continue;  // /issues also returns PRs
    const labels = (it.labels || []).map(l => typeof l === 'string' ? l : l.name);
    if (labels.includes(ONBOARDING_LABEL) || it.title === ONBOARDING_TITLE) {
      out.push(it.number);
    }
  }
  return out;
}

export async function findOpenOnboardingIssue() {
  const all = await findAllOpenOnboardingIssues();
  return all[0] || null;  // oldest = canonical
}

async function closeDuplicateOnboarding(dupe, canonical) {
  const o = owner();
  const r = repo();
  try {
    await ghFetch(`/repos/${o}/${r}/issues/${dupe}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: `Closing as duplicate of #${canonical}. Created during a brief GitHub label-index race: when the controller queried \`?labels=${ONBOARDING_LABEL}\` seconds after #${canonical} was created, indexing hadn't caught up and the controller spawned a second issue. Tracking onboarding at #${canonical}.`,
      }),
    });
    await ghFetch(`/repos/${o}/${r}/issues/${dupe}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
    });
    console.log(`[onboarding] closed duplicate #${dupe} (canonical #${canonical})`);
  } catch (e) {
    console.warn(`[onboarding] could not close duplicate #${dupe}:`, e.message);
  }
}

export async function repoNeedsOnboarding() {
  for (const f of ['CONTEXT.md', 'ARCHITECTURE.md', 'DESIGN.md']) {
    let file;
    try { file = await getRepoFile(f); } catch { file = null; }
    if (!file) return true;
    const content = Buffer.from(file.content || '', 'base64').toString('utf8');
    if (content.includes('<!-- explorer: empty -->')) return true;
  }
  return false;
}

export async function ensureOnboardingIssue() {
  const existing = await findAllOpenOnboardingIssues();
  if (existing.length > 0) {
    const canonical = existing[0];  // oldest
    // Self-heal any duplicates from the label-index race (or from prior
    // controller versions that lacked the title-fallback search).
    if (existing.length > 1) {
      console.log(`[onboarding] found ${existing.length} open — keeping #${canonical}, closing ${existing.length - 1} duplicate(s)`);
      for (const dupe of existing.slice(1)) {
        await closeDuplicateOnboarding(dupe, canonical);
      }
    }
    return { number: canonical, created: false, deduped: existing.length - 1 };
  }
  const o = owner();
  const r = repo();
  const resp = await ghFetch(`/repos/${o}/${r}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: ONBOARDING_TITLE,
      labels: ['agent-ready', ONBOARDING_LABEL],
      body: ONBOARDING_BODY,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`create onboarding issue failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return { number: data.number, created: true };
}

export async function getBranchProtection(branch = 'main') {
  const o = owner();
  const r = repo();
  const resp = await ghFetch(`/repos/${o}/${r}/branches/${branch}/protection`);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.message || text;
    if (resp.status === 403 && /upgrade to github pro|make this repository public/i.test(msg)) {
      const err = new Error('Branch protection on private repos requires a paid GitHub plan (Pro or higher). Either upgrade, make the repo public, or skip this check — it has no effect on the rest of the fleet.');
      err.code = 'GH_BRANCH_PROTECTION_UNAVAILABLE';
      throw err;
    }
    if (resp.status === 403 && /resource not accessible by integration/i.test(msg)) {
      const err = new Error(adminPermError() + `\n\nGitHub raw message: "${msg}"`);
      err.code = 'GH_APP_MISSING_ADMIN';
      throw err;
    }
    throw new Error(`GET branch protection failed (${resp.status}): ${msg}`);
  }
  return resp.json();
}
