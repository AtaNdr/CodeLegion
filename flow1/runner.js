// Flow 1 check runner.

import { updateState, readState } from '../state.js';
import { checks, checkById } from './checks.js';

export async function runOne(id) {
  const check = checkById(id);
  if (!check) throw new Error(`Unknown check: ${id}`);
  const started = Date.now();
  let result;
  try {
    result = await check.run();
  } catch (e) {
    result = { status: 'red', detail: e.message };
  }
  const entry = {
    status: result.status,
    detail: result.detail || '',
    fixable: !!(result.fixable || check.fixable),
    remediation: result.remediation || null,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
  updateState((s) => {
    s.checks = s.checks || {};
    s.checks[id] = entry;
  });
  return entry;
}

export async function runAll() {
  const results = {};
  for (const c of checks) {
    results[c.id] = await runOne(c.id);
  }
  return results;
}

export function getResults() {
  const s = readState();
  return s.checks || {};
}

export function summarize(results) {
  let red = 0, yellow = 0, green = 0, unknown = 0;
  for (const c of checks) {
    const status = results[c.id]?.status || 'unknown';
    if (status === 'green') green++;
    else if (status === 'yellow') yellow++;
    else if (status === 'red') red++;
    else unknown++;
  }
  return { red, yellow, green, unknown, total: checks.length, allGreen: green === checks.length };
}
