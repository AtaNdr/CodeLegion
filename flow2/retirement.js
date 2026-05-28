// Delete sleeping agents that haven't been waked in N days.
// Mirrors v1 controller/server.js:210-258.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compute, network } from '../azure/clients.js';
import { config } from '../config.js';
import { listAgents, isDeallocated, cleanupOrphans } from '../azure/vm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _cfg = null;
function cfg() {
  if (!_cfg) _cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8'));
  return _cfg;
}

export async function retireStaleAgents() {
  const retention = cfg().retirement || { enabled: false };
  if (!retention.enabled) return { retired: [], skipped: [], reason: 'disabled' };

  const rg = config.resourceGroup;
  const staleAfterDays = retention.staleAfterDays || 30;
  const cutoff = Date.now() - (staleAfterDays * 24 * 60 * 60 * 1000);

  const agents = await listAgents();
  const retired = [];
  const skipped = [];

  for (const agent of agents) {
    if (!isDeallocated(agent)) {
      skipped.push({ vmName: agent.vmName, reason: `state=${agent.powerState}` });
      continue;
    }
    const lastWake = agent.lastWake ? new Date(agent.lastWake).getTime() : null;
    const created = agent.created ? new Date(agent.created).getTime() : 0;
    const lastActivity = lastWake || created;
    if (lastActivity > cutoff) {
      skipped.push({ vmName: agent.vmName, reason: `last activity ${new Date(lastActivity).toISOString().slice(0, 10)}` });
      continue;
    }
    console.log(`[retirement] deleting stale ${agent.vmName} (last ${new Date(lastActivity).toISOString()})`);
    try {
      await compute().virtualMachines.beginDeleteAndWait(rg, agent.vmName);
      try { await network().networkInterfaces.beginDeleteAndWait(rg, `${agent.vmName}-nic`); } catch {}
      retired.push(agent.vmName);
    } catch (e) {
      console.error(`[retirement] failed for ${agent.vmName}:`, e.message);
      skipped.push({ vmName: agent.vmName, reason: `error: ${e.message}` });
    }
  }
  console.log(`[retirement] sweep: ${retired.length} retired, ${skipped.length} skipped`);
  return { retired, skipped };
}

async function sweep() {
  await retireStaleAgents().catch(e => console.error('[retirement] sweep failed:', e.message));
  // Always also clean orphan VM/NIC/disk resources — cheap, prevents the
  // subnet-IP leak and unbounded disk accumulation from failed creates.
  try {
    const r = await cleanupOrphans();
    const v = r.deleted.vms.length, n = r.deleted.nics.length, d = r.deleted.disks.length;
    if (v + n + d > 0) console.log(`[cleanup] removed orphans: vms=${v} nics=${n} disks=${d}`);
  } catch (e) { console.error('[cleanup] orphan sweep failed:', e.message); }
}

export function startRetirementSweep() {
  const retention = cfg().retirement || {};
  if (!retention.enabled) return;
  const intervalHours = retention.checkIntervalHours || 6;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  // First sweep after 60s, then on interval.
  setTimeout(() => sweep(), 60_000);
  setInterval(() => sweep(), intervalMs);
  console.log(`[retirement] scheduled every ${intervalHours}h (+ orphan resource cleanup)`);
}
