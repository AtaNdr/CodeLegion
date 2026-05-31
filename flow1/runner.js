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
  // If the check result explicitly sets `fixable: false`, respect that even
  // when the check's static config says it's fixable. Some failure modes
  // (e.g. feature unavailable on the user's GitHub plan) genuinely can't be
  // fixed from CodeLegion's side.
  const fixable = result.fixable === false
    ? false
    : !!(result.fixable || check.fixable);
  const entry = {
    status: result.status,
    detail: result.detail || '',
    fixable,
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
  let red = 0, yellow = 0, green = 0, unknown = 0, skipped = 0;
  // Only required (non-optional) checks count toward total / allDone. The
  // optional configuration rows (auth, vmConfig, pricing) still appear in
  // the table but never block setup completion.
  const required = checks.filter(c => !c.optional);
  for (const c of required) {
    const r = results[c.id];
    const status = r?.status || 'unknown';
    // A yellow row with fixable=false is genuinely skipped (e.g. branch
    // protection on a free-plan private repo). Count it separately so the
    // Flow 1 wizard can still complete.
    if (status === 'yellow' && r?.fixable === false) skipped++;
    else if (status === 'green') green++;
    else if (status === 'yellow') yellow++;
    else if (status === 'red') red++;
    else unknown++;
  }
  return {
    red, yellow, green, unknown, skipped, total: required.length,
    allGreen: green === required.length,
    // Setup is "done" when every required row is either green or explicitly skipped.
    allDone: (green + skipped) === required.length,
  };
}
