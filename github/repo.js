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
        message: current ? `agent-fleet v2: update ${filePath}` : `agent-fleet v2: add ${filePath}`,
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
        message: `agent-fleet v2: remove ${filePath}`,
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
  if (resp.status === 403) {
    const err = new Error('GitHub App is missing the "Administration: Read & write" repository permission. In github.com → your App settings → Permissions, set Administration to R/W, save, then accept the new permissions on the installation (the App will email you a link, or check Settings → Applications → Installed GitHub Apps → your App → Configure).');
    err.code = 'GH_APP_MISSING_ADMIN';
    throw err;
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Branch protection PUT failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

export async function getBranchProtection(branch = 'main') {
  const o = owner();
  const r = repo();
  const resp = await ghFetch(`/repos/${o}/${r}/branches/${branch}/protection`);
  if (resp.status === 404) return null;
  if (resp.status === 403) {
    const err = new Error('GitHub App is missing the "Administration" repository permission. Set it to Read & write in the App settings, save, then accept the new permissions on the installation.');
    err.code = 'GH_APP_MISSING_ADMIN';
    throw err;
  }
  if (!resp.ok) throw new Error(`GET branch protection failed: ${resp.status}`);
  return resp.json();
}
