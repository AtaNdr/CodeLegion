// Per-VM activity: live in-memory current status + per-VM timeline JSONL.
// Updated by POST /agent/status (single state change) and POST /agent/sync
// (batch append from the VM's local activity.jsonl).

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const ACTIVITY_DIR = path.join(config.dataDir, 'activity');

const liveStatus = new Map();  // vmName → { state, issue, summary, updatedAt }

function ensureDir() {
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
}

function fileFor(vmName) {
  const safe = String(vmName || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(ACTIVITY_DIR, `${safe}.jsonl`);
}

export function recordStatus({ vmName, state, issue, summary, agentName, agentEmoji, ts = new Date().toISOString() }) {
  if (!vmName) return;
  // Sticky agent identity — once the agent has told us its chosen name and
  // emoji, keep them across status updates that omit them. Lets old code
  // paths in the agent loop keep working without mandatory rewrites.
  const prev = liveStatus.get(vmName) || {};
  liveStatus.set(vmName, {
    state,
    issue: issue || null,
    summary: summary || null,
    agentName: agentName || prev.agentName || null,
    agentEmoji: agentEmoji || prev.agentEmoji || null,
    updatedAt: ts,
  });
}

export function appendTimelineLines(vmName, lines) {
  if (!vmName || !lines) return 0;
  ensureDir();
  const text = (Array.isArray(lines) ? lines.join('\n') : String(lines)).trim();
  if (!text) return 0;
  fs.appendFileSync(fileFor(vmName), text + '\n');
  return text.split('\n').length;
}

export function getStatus(vmName) {
  return liveStatus.get(vmName) || null;
}

export function allStatus() {
  return Object.fromEntries(liveStatus.entries());
}

export function readTimeline(vmName, { tail = 50 } = {}) {
  const file = fileFor(vmName);
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const slice = tail ? lines.slice(-tail) : lines;
  return slice.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
}
