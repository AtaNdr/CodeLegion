// VM lifecycle: list / spin / start / deallocate / delete / runCommand.
// Tagged with Purpose=coding-agent so listAgents can find them later.

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { compute, network } from './clients.js';
import { config } from '../config.js';
import { resourceNames } from './provision.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let fleetConfig = null;
function getFleetConfig() {
  if (!fleetConfig) {
    const cfgPath = path.resolve(__dirname, '..', 'config.json');
    fleetConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
  return fleetConfig;
}

async function collect(asyncIterable) {
  const out = [];
  for await (const item of asyncIterable) out.push(item);
  return out;
}

export async function listAgents() {
  const rg = config.resourceGroup;
  if (!rg) return [];
  const out = [];
  for await (const vm of compute().virtualMachines.list(rg)) {
    if (vm.tags?.Purpose !== 'coding-agent') continue;
    const view = await compute().virtualMachines.instanceView(rg, vm.name);
    const powerState = (view.statuses?.find(s => s.code?.startsWith('PowerState/'))?.code || 'unknown').replace('PowerState/', '');
    const provisioningState = (view.statuses?.find(s => s.code?.startsWith('ProvisioningState/'))?.code || 'unknown').replace('ProvisioningState/', '');
    out.push({
      vmName: vm.name,
      model: vm.tags?.Model || 'sonnet',
      repo: vm.tags?.Repo || null,
      lastWake: vm.tags?.LastWakeTime || null,
      created: vm.timeCreated || null,
      powerState,
      provisioningState,
    });
  }
  return out;
}

export const isAlive        = (a) => ['running', 'starting'].includes(a.powerState);
export const isDeallocated  = (a) => ['deallocated', 'stopped'].includes(a.powerState);
export const isWakeable     = (a) => isDeallocated(a);

export function groupByModel(agents) {
  const out = {};
  for (const a of agents) {
    out[a.model] = out[a.model] || [];
    out[a.model].push(a);
  }
  return out;
}

export async function startExistingAgent(vmName) {
  const rg = config.resourceGroup;
  console.log(`[vm] starting ${vmName}`);
  try {
    const vm = await compute().virtualMachines.get(rg, vmName);
    await compute().virtualMachines.beginUpdateAndWait(rg, vmName, {
      tags: { ...vm.tags, LastWakeTime: new Date().toISOString() },
    });
  } catch (e) {
    console.warn(`[vm] tag update failed for ${vmName}:`, e.message);
  }
  compute().virtualMachines.beginStart(rg, vmName)
    .catch(err => console.error(`[vm] start failed for ${vmName}:`, err.message));
  return vmName;
}

export async function deallocateAgent(vmName) {
  console.log(`[vm] deallocating ${vmName}`);
  compute().virtualMachines.beginDeallocate(config.resourceGroup, vmName)
    .catch(err => console.error(`[vm] deallocate failed for ${vmName}:`, err.message));
  return vmName;
}

export async function deleteAgent(vmName) {
  const rg = config.resourceGroup;
  console.log(`[vm] deleting ${vmName}`);
  await compute().virtualMachines.beginDeleteAndWait(rg, vmName);
  // Belt-and-braces NIC cleanup. New VMs are created with deleteOption:'Delete'
  // on the NIC so Azure auto-cleans, but old VMs predating that flag still
  // need the explicit delete. Log failures instead of silently swallowing.
  try {
    await network().networkInterfaces.beginDeleteAndWait(rg, `${vmName}-nic`);
  } catch (e) {
    if (!/NotFound|does not exist/i.test(e.message)) {
      console.warn(`[vm] could not delete NIC ${vmName}-nic:`, e.message);
    }
  }
  return vmName;
}

// Find and delete NICs in the RG that match our naming convention but are
// not attached to any VM. This catches orphans from failed VM creations
// (NIC created, VM creation errored) that exhaust the subnet's IP pool.
export async function cleanupOrphanedNics() {
  const rg = config.resourceGroup;
  if (!rg) return { scanned: 0, deleted: [], errors: [] };
  const all = [];
  for await (const n of network().networkInterfaces.list(rg)) all.push(n);
  const deleted = [];
  const errors = [];
  for (const nic of all) {
    if (!nic.name || !/-nic$/.test(nic.name)) continue;  // only our convention
    if (nic.virtualMachine) continue;                      // attached, skip
    try {
      console.log(`[cleanup] deleting orphan NIC ${nic.name}`);
      await network().networkInterfaces.beginDeleteAndWait(rg, nic.name);
      deleted.push(nic.name);
    } catch (e) {
      console.warn(`[cleanup] could not delete ${nic.name}:`, e.message);
      errors.push({ name: nic.name, error: e.message });
    }
  }
  return { scanned: all.length, deleted, errors };
}

// runCommand: synchronously execute a shell snippet on a RUNNING VM, return stdout.
// Used by the "Force sync" escape hatch.
export async function runShellCommand(vmName, script) {
  const rg = config.resourceGroup;
  const result = await compute().virtualMachines.beginRunCommandAndWait(rg, vmName, {
    commandId: 'RunShellScript',
    script: Array.isArray(script) ? script : [script],
  });
  const out = (result.value || []).map(v => v.message || '').join('\n');
  return out;
}

// ---- VM creation ---------------------------------------------------

function buildCloudInit({ repoUrl, model, idleTimeout }) {
  const required = ['CONTROLLER_PUBLIC_URL', 'REPORT_TOKEN', 'AGENT_SCRIPTS_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Cannot build cloud-init — missing: ${missing.join(', ')}`);

  const scriptsBase = (process.env.AGENT_SCRIPTS_URL || `${process.env.CONTROLLER_PUBLIC_URL}/scripts`).replace(/\/agent-scripts\.tar\.gz$/, '');
  const env = `MODEL=${model}
IDLE_TIMEOUT=${idleTimeout}
REPO_URL=${repoUrl}
CONTROLLER_URL=${process.env.CONTROLLER_PUBLIC_URL}
REPORT_TOKEN=${process.env.REPORT_TOKEN}
SCRIPTS_BASE=${scriptsBase}`;

  return `#cloud-config
package_update: true
packages: [curl, git, jq, build-essential, ca-certificates, gnupg, unzip]
write_files:
  - path: /etc/agent/env
    permissions: '0600'
    content: |
${env.split('\n').map(l => '      ' + l).join('\n')}
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  - apt-get install -y nodejs
  - curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  - chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
  - apt-get update -qq && apt-get install -y gh
  - npm install -g @anthropic-ai/claude-code
  - mkdir -p /workspace /var/lib/agent /var/log && chown azureuser:azureuser /workspace /var/lib/agent
  - curl -fsSL "${scriptsBase}/agent-loop.sh" -o /usr/local/bin/agent-loop.sh
  - curl -fsSL "${scriptsBase}/agent-bootstrap.sh" -o /usr/local/bin/agent-bootstrap.sh
  - curl -fsSL "${scriptsBase}/refresh-gh-token.sh" -o /usr/local/bin/refresh-gh-token.sh
  - chmod +x /usr/local/bin/agent-bootstrap.sh /usr/local/bin/agent-loop.sh /usr/local/bin/refresh-gh-token.sh
  - |
    cat > /etc/systemd/system/agent.service <<'EOF'
    [Unit]
    Description=Coding Agent Loop
    After=network-online.target
    [Service]
    Type=simple
    User=azureuser
    WorkingDirectory=/workspace
    EnvironmentFile=/etc/agent/env
    ExecStart=/usr/local/bin/agent-loop.sh
    StandardOutput=append:/var/log/agent.log
    StandardError=append:/var/log/agent.log
    Restart=on-failure
    RestartSec=30
    [Install]
    WantedBy=multi-user.target
    EOF
  - touch /var/log/agent.log && chown azureuser /var/log/agent.log
  - sudo -u azureuser bash -c 'cd /workspace && source /etc/agent/env && eval $(/usr/local/bin/refresh-gh-token.sh) && git clone "$REPO_URL" . && /usr/local/bin/agent-bootstrap.sh' || true
  - systemctl daemon-reload && systemctl enable agent.service && systemctl start agent.service
`;
}

export async function spinNewAgent({ repoUrl, model }) {
  const rg = config.resourceGroup;
  const location = process.env.AZURE_LOCATION;
  if (!location) throw new Error('AZURE_LOCATION not set (run Flow 1 network provision first)');

  const vmName = `agent-${model}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  const fleetCfg = getFleetConfig();
  const vmSize = fleetCfg.vmSize?.[model] || fleetCfg.vmSize?.sonnet || 'Standard_D2as_v4';

  console.log(`[vm] spinning new ${vmName} (${model}, ${vmSize})`);

  const subscriptionId = config.subscriptionId;
  const n = resourceNames();
  const vnetName = process.env.AZURE_VNET_NAME || n.vnet;
  const subnetName = process.env.AZURE_SUBNET_NAME || 'agents';
  const nsgName = process.env.AZURE_NSG_NAME || n.nsg;
  const subnetId = `/subscriptions/${subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Network/virtualNetworks/${vnetName}/subnets/${subnetName}`;
  const nsgId = `/subscriptions/${subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}`;

  const nic = await network().networkInterfaces.beginCreateOrUpdateAndWait(rg, `${vmName}-nic`, {
    location,
    networkSecurityGroup: { id: nsgId },
    ipConfigurations: [{
      name: 'ipconfig1',
      subnet: { id: subnetId },
      privateIPAllocationMethod: 'Dynamic',
    }],
  });

  const cloudInit = buildCloudInit({
    repoUrl, model,
    idleTimeout: fleetCfg.fleet?.idleTimeoutSeconds || 600,
  });

  const adminPassword = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '') + '!A1';

  const vmParams = {
    location,
    tags: { Purpose: 'coding-agent', Model: model, Repo: repoUrl, LastWakeTime: new Date().toISOString() },
    hardwareProfile: { vmSize },
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: 'latest' },
      // deleteOption ensures the OS disk is auto-deleted when the VM is.
      osDisk: { createOption: 'FromImage', diskSizeGB: 30, deleteOption: 'Delete' },
    },
    osProfile: {
      computerName: vmName.substring(0, 15),
      adminUsername: 'azureuser',
      ...(process.env.SSH_PUBLIC_KEY?.match(/^(ssh-|ecdsa-)\S+ [A-Za-z0-9+/]{20,}/)
        ? { linuxConfiguration: { disablePasswordAuthentication: true, ssh: { publicKeys: [{ path: '/home/azureuser/.ssh/authorized_keys', keyData: process.env.SSH_PUBLIC_KEY }] } } }
        : { adminPassword }),
      customData: Buffer.from(cloudInit).toString('base64'),
    },
    // deleteOption:'Delete' ensures the NIC is auto-deleted when the VM is,
    // releasing its subnet IP. Prevents the "subnet has no capacity" leak
    // that builds up across many VM lifecycles.
    networkProfile: { networkInterfaces: [{ id: nic.id, primary: true, deleteOption: 'Delete' }] },
    // No user-assigned identity in v2 — VMs fetch secrets via /agent/secrets.
  };

  // Fire-and-forget VM creation so the caller (webhook/reconcile) returns
  // fast. If creation fails AFTER we created the NIC, we'd leak the NIC —
  // so on failure, async-clean the NIC we just created.
  compute().virtualMachines.beginCreateOrUpdate(rg, vmName, vmParams)
    .catch(async (err) => {
      console.error(`[vm] create failed for ${vmName}:`, err.message);
      try {
        await network().networkInterfaces.beginDeleteAndWait(rg, `${vmName}-nic`);
        console.log(`[vm] cleaned up orphan NIC ${vmName}-nic after failed VM create`);
      } catch (e) {
        console.warn(`[vm] could not clean orphan NIC ${vmName}-nic:`, e.message);
      }
    });
  return vmName;
}
