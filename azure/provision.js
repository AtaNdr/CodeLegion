// Provision the 5 network resources Flow 1 needs:
//   1. NSG  (no inbound rules)
//   2. Public IP  (Standard SKU, Static)
//   3. NAT Gateway  (uses public IP)
//   4. VNet 10.0.0.0/16
//   5. Subnet 'agents' 10.0.1.0/24  (references NSG + NAT)

import { network, resources } from './clients.js';
import { config } from '../config.js';
import { updateState, readState } from '../state.js';

const VNET_CIDR = '10.0.0.0/16';
const SUBNET_NAME = 'agents';
const SUBNET_CIDR = '10.0.1.0/24';

function suffix() {
  const name = (config.webAppName || 'fleet').toLowerCase();
  // strip common prefixes ("agent-fleet-", etc), keep alnum, max 8 chars.
  return name.replace(/^(agent-fleet-|agentfleet-|fleet-)/, '').replace(/[^a-z0-9]/g, '').slice(0, 8) || 'fleet';
}

function names() {
  const s = suffix();
  return {
    suffix: s,
    vnet: `agentfleet-${s}-vnet`,
    nsg: `agentfleet-${s}-nsg`,
    pip: `agentfleet-${s}-pip`,
    nat: `agentfleet-${s}-nat`,
    vmIdentity: `agentfleet-${s}-vmid`,  // not provisioned; left for future
  };
}

async function getLocation() {
  if (config.region) return config.region;
  const rg = await resources().resourceGroups.get(config.resourceGroup);
  return rg.location;
}

async function ensureNsg(location, n) {
  console.log(`[provision] NSG: ${n.nsg}`);
  return network().networkSecurityGroups.beginCreateOrUpdateAndWait(
    config.resourceGroup,
    n.nsg,
    {
      location,
      securityRules: [],  // no inbound; outbound default-allow
    },
  );
}

async function ensurePublicIp(location, n) {
  console.log(`[provision] Public IP: ${n.pip}`);
  return network().publicIPAddresses.beginCreateOrUpdateAndWait(
    config.resourceGroup,
    n.pip,
    {
      location,
      sku: { name: 'Standard', tier: 'Regional' },
      publicIPAllocationMethod: 'Static',
      publicIPAddressVersion: 'IPv4',
    },
  );
}

async function ensureNatGateway(location, n, publicIpId) {
  console.log(`[provision] NAT Gateway: ${n.nat}`);
  return network().natGateways.beginCreateOrUpdateAndWait(
    config.resourceGroup,
    n.nat,
    {
      location,
      sku: { name: 'Standard' },
      publicIPAddresses: [{ id: publicIpId }],
      idleTimeoutInMinutes: 4,
    },
  );
}

async function ensureVnetWithSubnet(location, n, nsgId, natId) {
  console.log(`[provision] VNet + subnet: ${n.vnet} / ${SUBNET_NAME}`);
  return network().virtualNetworks.beginCreateOrUpdateAndWait(
    config.resourceGroup,
    n.vnet,
    {
      location,
      addressSpace: { addressPrefixes: [VNET_CIDR] },
      subnets: [{
        name: SUBNET_NAME,
        addressPrefix: SUBNET_CIDR,
        networkSecurityGroup: { id: nsgId },
        natGateway: { id: natId },
      }],
    },
  );
}

export async function provisionNetwork() {
  if (!config.resourceGroup) throw new Error('No resource group configured');
  const location = await getLocation();
  const n = names();

  const [nsg, pip] = await Promise.all([
    ensureNsg(location, n),
    ensurePublicIp(location, n),
  ]);

  const nat = await ensureNatGateway(location, n, pip.id);
  const vnet = await ensureVnetWithSubnet(location, n, nsg.id, nat.id);
  const subnet = vnet.subnets.find(s => s.name === SUBNET_NAME) || vnet.subnets[0];

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
  });

  return { vnet, subnet, nsg, pip, nat, location };
}

export function resourceNames() {
  return names();
}
