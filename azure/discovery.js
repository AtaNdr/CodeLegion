// Self-discovery: enumerate the resources Flow 1 cares about in the Web App's
// own resource group. The orchestrator self-locates from WEBSITE_RESOURCE_GROUP.

import { network, resources } from './clients.js';
import { config } from '../config.js';

async function collect(asyncIterable) {
  const out = [];
  for await (const item of asyncIterable) out.push(item);
  return out;
}

const slim = (item) => ({
  id: item.id,
  name: item.name,
  location: item.location,
  type: item.type,
});

export async function discoverResourceGroup() {
  const rg = config.resourceGroup;
  if (!rg) return null;
  try {
    const r = await resources().resourceGroups.get(rg);
    return { name: r.name, location: r.location, id: r.id };
  } catch (e) {
    return { name: rg, error: e.message };
  }
}

export async function listAllResources() {
  const rg = config.resourceGroup;
  if (!rg) return [];
  return collect(resources().resources.listByResourceGroup(rg));
}

export async function discoverNetwork() {
  const rg = config.resourceGroup;
  if (!rg) throw new Error('No resource group configured');

  const [vnetsRaw, nsgsRaw, natsRaw] = await Promise.all([
    collect(network().virtualNetworks.list(rg)),
    collect(network().networkSecurityGroups.list(rg)),
    collect(network().natGateways.list(rg)),
  ]);

  const vnets = vnetsRaw.map((v) => ({
    ...slim(v),
    addressSpace: v.addressSpace?.addressPrefixes || [],
    subnets: (v.subnets || []).map((s) => ({
      name: s.name,
      addressPrefix: s.addressPrefix,
      nsg: s.networkSecurityGroup?.id || null,
      natGateway: s.natGateway?.id || null,
    })),
  }));

  return {
    vnets,
    nsgs: nsgsRaw.map(slim),
    natGateways: natsRaw.map(slim),
  };
}

// Count every resource in the RG, grouped by type. Cheap (one Resources
// API call). Each entry is { type, count }, sorted by count descending.
// `total` is the sum so the UI can show e.g. "12 resources" at a glance.
export async function discoverResourceCounts() {
  const rg = config.resourceGroup;
  if (!rg) return { total: 0, byType: [] };
  const byTypeMap = new Map();
  try {
    for await (const r of resources().resources.listByResourceGroup(rg)) {
      const t = r.type || 'unknown';
      byTypeMap.set(t, (byTypeMap.get(t) || 0) + 1);
    }
  } catch (e) {
    return { total: 0, byType: [], error: e.message };
  }
  const byType = Array.from(byTypeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const total = byType.reduce((n, x) => n + x.count, 0);
  return { total, byType };
}

export async function discoverAll() {
  const rg = await discoverResourceGroup();
  let net = { vnets: [], nsgs: [], natGateways: [] };
  let netError = null;
  let resourceCounts = { total: 0, byType: [] };
  try {
    net = await discoverNetwork();
  } catch (e) {
    netError = e.message;
  }
  try {
    resourceCounts = await discoverResourceCounts();
  } catch (e) {
    resourceCounts = { total: 0, byType: [], error: e.message };
  }
  return { rg, network: net, netError, resourceCounts };
}
