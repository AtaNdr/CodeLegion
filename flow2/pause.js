// Fleet pause/resume flag.
//
// Persists at /home/data/fleet-pause.json so the state survives controller
// restarts (App Service can recycle the instance any time). When paused:
//   - reconcile early-returns (no assignments, no spins, no wakes).
//   - the webhook still arrives but reconcile is a no-op.
//   - existing running agents are deallocated by the pause action itself
//     (see /admin/fleet/pause in flow2/routes.js).

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const PAUSE_FILE = path.join(config.dataDir, 'fleet-pause.json');

function read() {
  try {
    if (!fs.existsSync(PAUSE_FILE)) return { paused: false };
    return JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8'));
  } catch { return { paused: false }; }
}

export function isPaused() {
  return read().paused === true;
}

export function getPauseState() {
  return read();
}

export function setPaused(paused, reason = null) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const data = { paused: !!paused, reason, updatedAt: new Date().toISOString() };
  const tmp = PAUSE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, PAUSE_FILE);
  return data;
}
