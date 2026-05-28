// Aggressive RG cleanup for "Uninstall CodeLegion".
//
// Removes every resource in the configured RG EXCEPT the Web App that hosts
// the controller and its App Service Plan. The user pre-created those in
// Setup step 2; CodeLegion didn't make them and shouldn't kill the surface
// it's running on.
//
// Order matters for ARM dependencies:
//   1. VMs        — cascades attached NICs + OS disks via deleteOption.
//   2. NICs       — anything left standalone (pre-deleteOption era).
//   3. Disks      — orphans by name pattern or fully-managed=null.
//   4. VNets      — subnets cascade; releases NSG/NAT subnet associations.
//   5. NATs       — now no subnet refs them.
//   6. Public IPs — now no NAT/NIC refs them.
//   7. NSGs       — now no subnet/NIC refs them.
//
// After the typed passes, list anything still in the RG via the generic
// Resources client. Web App + Plan are expected; anything else is reported
// as 'unknown' so the operator can clean by hand without surprise.

import { compute, network, resources } from './clients.js';
import { config } from '../config.js';
import { setPaused } from '../flow2/pause.js';

async function tryDelete(label, fn, results) {
  try { await fn(); results.deleted.push(label); }
  catch (e) {
    if (/NotFound|does not exist|ResourceNotFound/i.test(e.message)) {
      results.skipped.push({ ...label, reason: 'already gone' });
    } else {
      results.errors.push({ ...label, error: e.message });
    }
  }
}

async function listAll(asyncIter) {
  const out = [];
  for await (const item of asyncIter) out.push(item);
  return out;
}

export async function cleanAzureResources() {
  const rg = config.resourceGroup;
  const results = {
    pausedFleet: false,
    deleted: [],
    skipped: [],
    kept: [],
    unknown: [],
    errors: [],
  };
  if (!rg) {
    results.errors.push({ kind: 'rg', error: 'resourceGroup not set' });
    return results;
  }

  // Pause the fleet first so reconcile doesn't try to spawn new VMs into
  // the network we're about to tear down. Leave it paused — re-running
  // Flow 1 + Resume is the unambiguous path back.
  try { setPaused(true, 'uninstall — clean azure'); results.pausedFleet = true; }
  catch (e) { results.errors.push({ kind: 'pause', error: e.message }); }

  const webAppName = config.webAppName || process.env.WEBSITE_SITE_NAME;

  // 1) VMs — cascades NIC + OS disk via deleteOption set at create time.
  try {
    for (const vm of await listAll(compute().virtualMachines.list(rg))) {
      await tryDelete({ kind: 'vm', name: vm.name },
        () => compute().virtualMachines.beginDeleteAndWait(rg, vm.name), results);
    }
  } catch (e) { results.errors.push({ kind: 'vm-list', error: e.message }); }

  // 2) Stragglers — NICs that survived the cascade (pre-deleteOption VMs).
  try {
    for (const nic of await listAll(network().networkInterfaces.list(rg))) {
      await tryDelete({ kind: 'nic', name: nic.name },
        () => network().networkInterfaces.beginDeleteAndWait(rg, nic.name), results);
    }
  } catch (e) { results.errors.push({ kind: 'nic-list', error: e.message }); }

  // 3) Disks.
  try {
    for (const disk of await listAll(compute().disks.list(rg))) {
      await tryDelete({ kind: 'disk', name: disk.name },
        () => compute().disks.beginDeleteAndWait(rg, disk.name), results);
    }
  } catch (e) { results.errors.push({ kind: 'disk-list', error: e.message }); }

  // 4) VNets (cascades subnets, releasing NSG + NAT subnet associations).
  try {
    for (const vnet of await listAll(network().virtualNetworks.list(rg))) {
      await tryDelete({ kind: 'vnet', name: vnet.name },
        () => network().virtualNetworks.beginDeleteAndWait(rg, vnet.name), results);
    }
  } catch (e) { results.errors.push({ kind: 'vnet-list', error: e.message }); }

  // 5) NAT gateways.
  try {
    for (const nat of await listAll(network().natGateways.list(rg))) {
      await tryDelete({ kind: 'nat', name: nat.name },
        () => network().natGateways.beginDeleteAndWait(rg, nat.name), results);
    }
  } catch (e) { results.errors.push({ kind: 'nat-list', error: e.message }); }

  // 6) Public IPs.
  try {
    for (const pip of await listAll(network().publicIPAddresses.list(rg))) {
      await tryDelete({ kind: 'pip', name: pip.name },
        () => network().publicIPAddresses.beginDeleteAndWait(rg, pip.name), results);
    }
  } catch (e) { results.errors.push({ kind: 'pip-list', error: e.message }); }

  // 7) NSGs (last — they're referenced by subnets and NICs that we deleted above).
  try {
    for (const nsg of await listAll(network().networkSecurityGroups.list(rg))) {
      await tryDelete({ kind: 'nsg', name: nsg.name },
        () => network().networkSecurityGroups.beginDeleteAndWait(rg, nsg.name), results);
    }
  } catch (e) { results.errors.push({ kind: 'nsg-list', error: e.message }); }

  // Final sweep: anything we don't recognise. Web App + plan are expected
  // (we run on them). Anything else is reported so the operator can clean
  // it manually — we don't generic-delete unknowns because we'd need to
  // pick an apiVersion for each provider and that's a guess.
  try {
    for await (const r of resources().resources.listByResourceGroup(rg)) {
      const t = r.type;
      if (t === 'Microsoft.Web/sites' && (!webAppName || r.name === webAppName)) {
        results.kept.push({ kind: 'web-app', name: r.name, type: t });
        continue;
      }
      if (t === 'Microsoft.Web/serverfarms') {
        results.kept.push({ kind: 'app-service-plan', name: r.name, type: t });
        continue;
      }
      results.unknown.push({ name: r.name, type: t, id: r.id });
    }
  } catch (e) { results.errors.push({ kind: 'final-enum', error: e.message }); }

  return results;
}
