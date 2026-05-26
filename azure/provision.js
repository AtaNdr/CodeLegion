// Provision the network resources Flow 1 needs.
//
// Azure retired default outbound access for new VMs (and for App Service with
// VNet integration), so the Web App will have already been wired through a
// VNet + NAT + Public IP by the user during step 2 of SETUP.md — otherwise it
// has no internet. CodeLegion ADOPTS that existing networking rather than
// duplicating it.
//
// What we do here:
//   1. Find the user's existing VNet in the RG.
//   2. Reuse their NAT gateway + Public IP if present, else create them.
//   3. Reuse a "no-inbound" NSG if one exists, else create one for agent VMs.
//   4. Add an `agents` subnet to the existing VNet, with NSG + NAT attached.
//
// If no VNet exists yet (rare — the user may have skipped VNet integration),
// we fall back to creating the whole stack from scratch.

import { network, resources } from './clients.js';
import { config } from '../config.js';
import { updateState } from '../state.js';

const SUBNET_NAME = 'agents';
const FALLBACK_VNET_CIDR = '10.0.0.0/16';
const SUBNET_CIDR_FALLBACK = '10.0.1.0/24';

function suffix() {
  const name = (config.webAppName || 'fleet').toLowerCase();
  return name
    .replace(/^(agent-fleet-|agentfleet-|fleet-|codelegion-|legion-)/, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8) || 'fleet';
}

function names() {
  const s = suffix();
  return {
    suffix: s,
    vnet: `codelegion-${s}-vnet`,
    nsg: `codelegion-${s}-nsg`,
    pip: `codelegion-${s}-pip`,
    nat: `codelegion-${s}-nat`,
  };
}

async function getLocation() {
  if (config.region) return config.region;
  const rg = await resources().resourceGroups.get(config.resourceGroup);
  return rg.location;
}

async function collect(asyncIterable) {
  const out = [];
  for await (const x of asyncIterable) out.push(x);
  return out;
}

// ---- Subnet CIDR allocation -------------------------------------
// Given a VNet's address space and existing subnets, find a free /24 that
// doesn't collide. Naive — picks the lowest available /24 in the first
// matching /16-or-larger address prefix.
function pickFreeSubnetCidr(vnet) {
  const addressSpace = vnet.addressSpace?.addressPrefixes || [];
  const existing = (vnet.subnets || []).map(s => s.addressPrefix).filter(Boolean);
  for (const prefix of addressSpace) {
    const m = prefix.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
    if (!m) continue;
    const [, a, b, , , size] = m;
    if (parseInt(size, 10) > 24) continue; // need at least /24 of room
    for (let third = 0; third < 256; third++) {
      const candidate = `${a}.${b}.${third}.0/24`;
      if (!cidrsOverlap(candidate, existing)) return candidate;
    }
  }
  return null;
}

function cidrToRange(cidr) {
  const m = cidr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  if (!m) return null;
  const [, a, b, c, d, p] = m.map((x, i) => i === 0 ? x : parseInt(x, 10));
  const ip = (a << 24 >>> 0) + (b << 16) + (c << 8) + d;
  const mask = p === 0 ? 0 : (~0 << (32 - p)) >>> 0;
  const start = (ip & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return [start, end];
}

function cidrsOverlap(a, others) {
  const ra = cidrToRange(a);
  if (!ra) return true;
  for (const o of others) {
    const ro = cidrToRange(o);
    if (!ro) continue;
    if (!(ra[1] < ro[0] || ra[0] > ro[1])) return true;
  }
  return false;
}

// ---- Resource adopt-or-create -----------------------------------
async function findOrCreateNsg(location, n) {
  const rg = config.resourceGroup;
  const existing = await collect(network().networkSecurityGroups.list(rg));
  // Prefer one named for codelegion; else pick any with no inbound rules; else create.
  const ours = existing.find(g => g.name === n.nsg);
  if (ours) {
    console.log(`[provision] NSG: reusing ${ours.name}`);
    return ours;
  }
  console.log(`[provision] NSG: creating ${n.nsg}`);
  return network().networkSecurityGroups.beginCreateOrUpdateAndWait(
    rg, n.nsg, { location, securityRules: [] },
  );
}

async function findOrCreatePublicIp(location, n) {
  const rg = config.resourceGroup;
  const existing = await collect(network().publicIPAddresses.list(rg));
  // Prefer an unattached Standard Static IPv4. If user attached one to their NAT,
  // we'll discover the NAT below and use its IP indirectly.
  const standalone = existing.find(p =>
    p.sku?.name === 'Standard' &&
    p.publicIPAllocationMethod === 'Static' &&
    p.publicIPAddressVersion === 'IPv4'
  );
  if (standalone) {
    console.log(`[provision] Public IP: reusing ${standalone.name}`);
    return standalone;
  }
  console.log(`[provision] Public IP: creating ${n.pip}`);
  return network().publicIPAddresses.beginCreateOrUpdateAndWait(rg, n.pip, {
    location,
    sku: { name: 'Standard', tier: 'Regional' },
    publicIPAllocationMethod: 'Static',
    publicIPAddressVersion: 'IPv4',
  });
}

async function findOrCreateNatGateway(location, n, publicIpId) {
  const rg = config.resourceGroup;
  const existing = await collect(network().natGateways.list(rg));
  if (existing.length > 0) {
    const reused = existing[0];
    console.log(`[provision] NAT Gateway: reusing ${reused.name}`);
    return reused;
  }
  console.log(`[provision] NAT Gateway: creating ${n.nat}`);
  return network().natGateways.beginCreateOrUpdateAndWait(rg, n.nat, {
    location,
    sku: { name: 'Standard' },
    publicIPAddresses: [{ id: publicIpId }],
    idleTimeoutInMinutes: 4,
  });
}

async function findExistingVnet() {
  const rg = config.resourceGroup;
  const existing = await collect(network().virtualNetworks.list(rg));
  return existing[0] || null;
}

async function createFreshVnet(location, n, nsgId, natId) {
  const rg = config.resourceGroup;
  console.log(`[provision] VNet: creating ${n.vnet} with subnet ${SUBNET_NAME}`);
  return network().virtualNetworks.beginCreateOrUpdateAndWait(rg, n.vnet, {
    location,
    addressSpace: { addressPrefixes: [FALLBACK_VNET_CIDR] },
    subnets: [{
      name: SUBNET_NAME,
      addressPrefix: SUBNET_CIDR_FALLBACK,
      networkSecurityGroup: { id: nsgId },
      natGateway: { id: natId },
    }],
  });
}

async function ensureAgentsSubnet(vnet, nsgId, natId) {
  const rg = config.resourceGroup;
  const existing = (vnet.subnets || []).find(s => s.name === SUBNET_NAME);
  if (existing) {
    // Confirm it has NSG + NAT attached; patch if not.
    const needsNsg = !existing.networkSecurityGroup?.id;
    const needsNat = !existing.natGateway?.id;
    if (!needsNsg && !needsNat) {
      console.log(`[provision] subnet '${SUBNET_NAME}': already configured`);
      return existing;
    }
    console.log(`[provision] subnet '${SUBNET_NAME}': patching (nsg=${needsNsg}, nat=${needsNat})`);
    return network().subnets.beginCreateOrUpdateAndWait(rg, vnet.name, SUBNET_NAME, {
      addressPrefix: existing.addressPrefix,
      networkSecurityGroup: { id: nsgId },
      natGateway: { id: natId },
    });
  }
  const cidr = pickFreeSubnetCidr(vnet);
  if (!cidr) {
    throw new Error(`No free /24 in VNet ${vnet.name} address space ${(vnet.addressSpace?.addressPrefixes || []).join(', ')}. Expand the VNet or delete an unused subnet.`);
  }
  console.log(`[provision] subnet '${SUBNET_NAME}': creating in ${vnet.name} at ${cidr}`);
  return network().subnets.beginCreateOrUpdateAndWait(rg, vnet.name, SUBNET_NAME, {
    addressPrefix: cidr,
    networkSecurityGroup: { id: nsgId },
    natGateway: { id: natId },
  });
}

// ---- Top-level ---------------------------------------------------
export async function provisionNetwork() {
  if (!config.resourceGroup) throw new Error('No resource group configured');
  const location = await getLocation();
  const n = names();

  // Start by trying to adopt the user's existing networking.
  const existingVnet = await findExistingVnet();

  // NSG + Public IP + NAT — adopt or create.
  const [nsg, pip] = await Promise.all([
    findOrCreateNsg(location, n),
    findOrCreatePublicIp(location, n),
  ]);
  const nat = await findOrCreateNatGateway(location, n, pip.id);

  let vnet, subnet;
  if (existingVnet) {
    console.log(`[provision] VNet: adopting existing ${existingVnet.name}`);
    subnet = await ensureAgentsSubnet(existingVnet, nsg.id, nat.id);
    // Refresh vnet for chosen-state.
    vnet = await network().virtualNetworks.get(config.resourceGroup, existingVnet.name);
  } else {
    console.log(`[provision] No existing VNet found — creating fresh ${n.vnet}`);
    vnet = await createFreshVnet(location, n, nsg.id, nat.id);
    subnet = vnet.subnets.find(s => s.name === SUBNET_NAME) || vnet.subnets[0];
  }

  updateState((s) => {
    s.region = location;
    s.chosen = s.chosen || {};
    s.chosen.vnet = vnet.name;
    s.chosen.vnetId = vnet.id;
    s.chosen.subnet = subnet.name;
    s.chosen.subnetId = subnet.id;
    s.chosen.nsg = nsg.name;
    s.chosen.nsgId = nsg.id;
    s.chosen.publicIp = pip.name;
    s.chosen.publicIpId = pip.id;
    s.chosen.natGateway = nat.name;
    s.chosen.natGatewayId = nat.id;
    s.chosen.adoptedExistingVnet = !!existingVnet;
  });

  return { vnet, subnet, nsg, pip, nat, location, adopted: !!existingVnet };
}

export function resourceNames() {
  return names();
}
