// Flow 1 setup state — JSON blob on the Web App's persistent disk.
//
// Lives in /home/data/flow1.json. App Service /home/ persists across restarts;
// it's lost only when the Web App itself is deleted. That's acceptable since the
// same delete would wipe everything Flow 1 created anyway.

import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const STATE_PATH = path.join(config.dataDir, 'flow1.json');

function emptyState() {
  return {
    version: 2,
    rg: config.resourceGroup,
    region: null,
    checks: {},
    discovered: { vnets: [], subnets: [], nsgs: [], natGateways: [] },
    chosen: {},
    github: {},
    updatedAt: null,
  };
}

function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

export function readState() {
  try {
    ensureDataDir();
    if (!fs.existsSync(STATE_PATH)) return emptyState();
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    console.warn('[state] read failed, returning empty:', e.message);
    return emptyState();
  }
}

export function writeState(state) {
  ensureDataDir();
  state.updatedAt = new Date().toISOString();
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
  return state;
}

export function updateState(mutator) {
  const s = readState();
  mutator(s);
  return writeState(s);
}
