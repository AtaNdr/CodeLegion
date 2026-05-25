// Combined fleet snapshot used by the UI: VMs + live activity + counts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listAgents, isAlive, isDeallocated, groupByModel } from '../azure/vm.js';
import { allStatus } from './activity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _cfg = null;
function cfg() {
  if (!_cfg) _cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8'));
  return _cfg;
}

export async function fleetSnapshot() {
  const agents = await listAgents();
  const live = allStatus();
  const enriched = agents.map(a => ({
    ...a,
    activity: live[a.vmName] || null,
  }));
  const alive = enriched.filter(isAlive);
  const deallocated = enriched.filter(isDeallocated);
  const byModel = groupByModel(enriched);
  return {
    fleet: cfg().fleet,
    total: enriched.length,
    aliveCount: alive.length,
    sleepingCount: deallocated.length,
    byModel: Object.fromEntries(Object.entries(byModel).map(([m, list]) => [m, list.length])),
    agents: enriched,
  };
}
