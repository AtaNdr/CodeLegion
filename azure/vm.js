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

// ---- VM creation outcome tracking ---------------------------------
// beginCreateOrUpdate is fire-and-forget — without tracking, we never see
// async provisioning failures (quota, image, region capacity, etc.). We
// keep:
//   - vmInFlight: VMs whose async create hasn't resolved yet, so reconcile
//     can include them in capacity counts and avoid over-spinning.
//   - vmOutcomes: ring buffer of recent create attempts (newest last) with
//     status/error, surfaced in the UI so failures aren't silent.
const VM_OUTCOMES_MAX = 30;
const IN_FLIGHT_TTL_MS = 5 * 60 * 1000;
const vmInFlight = new Map();   // vmName → { model, at }
const vmOutcomes = [];          // newest last

function recordOutcome(o) {
  vmOutcomes.push(o);
  while (vmOutcomes.length > VM_OUTCOMES_MAX) vmOutcomes.shift();
}

export function inFlightCount(model) {
  for (const [vm, info] of vmInFlight) {
    if (Date.now() - info.at > IN_FLIGHT_TTL_MS) vmInFlight.delete(vm);
  }
  let n = 0;
  for (const info of vmInFlight.values()) if (info.model === model) n++;
  return n;
}

export function getVmCreateOutcomes() {
  return vmOutcomes.slice().reverse();  // newest first
}

// Sweep up orphaned per-agent resources in the RG. Three categories:
//
//   1. Agent VMs in a Failed provisioning state. Deleting the VM cascades
//      to the NIC and OS disk via deleteOption:'Delete' set at create time
//      — the cleanest path. Belt-and-braces NIC delete still handled in (2).
//   2. Orphan NICs (`*-nic` naming, no `virtualMachine` reference). Try a
//      VM-delete on the stripped name first (in case a stale VM resource
//      lingered and would cascade-drop the disk); fall back to deleting
//      the NIC directly. Failure to release these leaks subnet IPs.
//   3. Orphan OS disks (matching `agent-*` naming, `managedBy` null). Pre-
//      `deleteOption` VMs leave these behind on delete.
//
// Response shape is broader than the old "nics only" — UI surfaces each
// category separately.
export async function cleanupOrphans() {
  const rg = config.resourceGroup;
  const empty = { vms: [], nics: [], disks: [] };
  if (!rg) return { scanned: { vms: 0, nics: 0, disks: 0 }, deleted: empty, errors: [] };

  const deleted = { vms: [], nics: [], disks: [] };
  const errors = [];
  const seenDeleted = new Set();  // dedupe across (1) and (2) cascade overlap

  // 1) Failed agent VMs — cascade-delete.
  let vmsScanned = 0;
  try {
    for await (const vm of compute().virtualMachines.list(rg)) {
      vmsScanned++;
      if (vm.tags?.Purpose !== 'coding-agent') continue;
      let provState = '';
      try {
        const view = await compute().virtualMachines.instanceView(rg, vm.name);
        provState = (view.statuses?.find(s => s.code?.startsWith('ProvisioningState/'))?.code || '').replace('ProvisioningState/', '');
      } catch { /* ignore — fall through */ }
      if (!/^failed$/i.test(provState)) continue;
      try {
        console.log(`[cleanup] deleting failed VM ${vm.name} (cascades NIC+disk)`);
        await compute().virtualMachines.beginDeleteAndWait(rg, vm.name);
        deleted.vms.push(vm.name);
        seenDeleted.add(vm.name);
      } catch (e) {
        errors.push({ kind: 'vm', name: vm.name, error: e.message });
      }
    }
  } catch (e) {
    errors.push({ kind: 'vm-list', error: e.message });
  }

  // 2) Orphan NICs — VM cascade first, direct NIC delete fallback.
  let nicsScanned = 0;
  try {
    const nics = [];
    for await (const n of network().networkInterfaces.list(rg)) nics.push(n);
    nicsScanned = nics.length;
    for (const nic of nics) {
      if (!nic.name || !/-nic$/.test(nic.name)) continue;
      if (nic.virtualMachine) continue;                  // attached, skip
      const vmName = nic.name.replace(/-nic$/, '');
      if (seenDeleted.has(vmName)) continue;             // already cascaded
      let cascaded = false;
      try {
        await compute().virtualMachines.beginDeleteAndWait(rg, vmName);
        cascaded = true;
        deleted.vms.push(vmName);
        seenDeleted.add(vmName);
        console.log(`[cleanup] cascaded delete via stale VM ${vmName}`);
      } catch (e) {
        if (!/NotFound|does not exist|ResourceNotFound/i.test(e.message)) {
          errors.push({ kind: 'vm-cascade', name: vmName, error: e.message });
        }
      }
      if (cascaded) continue;
      try {
        console.log(`[cleanup] deleting orphan NIC ${nic.name}`);
        await network().networkInterfaces.beginDeleteAndWait(rg, nic.name);
        deleted.nics.push(nic.name);
      } catch (e) {
        errors.push({ kind: 'nic', name: nic.name, error: e.message });
      }
    }
  } catch (e) {
    errors.push({ kind: 'nic-list', error: e.message });
  }

  // 3) Orphan disks — must match our naming and be unmanaged.
  let disksScanned = 0;
  try {
    const disks = [];
    for await (const d of compute().disks.list(rg)) disks.push(d);
    disksScanned = disks.length;
    for (const disk of disks) {
      if (!disk.name || !disk.name.startsWith('agent-')) continue;
      if (disk.managedBy) continue;                      // attached to a VM
      try {
        console.log(`[cleanup] deleting orphan disk ${disk.name}`);
        await compute().disks.beginDeleteAndWait(rg, disk.name);
        deleted.disks.push(disk.name);
      } catch (e) {
        errors.push({ kind: 'disk', name: disk.name, error: e.message });
      }
    }
  } catch (e) {
    errors.push({ kind: 'disk-list', error: e.message });
  }

  return {
    scanned: { vms: vmsScanned, nics: nicsScanned, disks: disksScanned },
    deleted,
    errors,
  };
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

  // Fire-and-forget from the caller's POV, but use beginCreateOrUpdateAndWait
  // so the .then/.catch reflects the ACTUAL provisioning result (not just
  // request acceptance). Tracks in-flight so reconcile doesn't over-spin
  // while creation is mid-flight; records the outcome so failures show in
  // the UI instead of disappearing into App Service logs.
  vmInFlight.set(vmName, { model, at: Date.now() });
  recordOutcome({ vmName, model, at: new Date().toISOString(), status: 'in-flight' });

  compute().virtualMachines.beginCreateOrUpdateAndWait(rg, vmName, vmParams)
    .then(() => {
      vmInFlight.delete(vmName);
      recordOutcome({ vmName, model, at: new Date().toISOString(), status: 'created' });
      console.log(`[vm] ${vmName} provisioned successfully`);
    })
    .catch(async (err) => {
      vmInFlight.delete(vmName);
      const errMsg = (err && err.message) || String(err);
      recordOutcome({ vmName, model, at: new Date().toISOString(), status: 'failed', error: errMsg });
      console.error(`[vm] create failed for ${vmName}:`, errMsg);
      // Prefer VM-delete: if Azure registered the VM resource before failing
      // (very common with quota / image / capacity errors), this cascades to
      // the NIC and OS disk via their deleteOption:'Delete'. A direct NIC
      // delete on its own would leave the disk behind.
      let cascaded = false;
      try {
        await compute().virtualMachines.beginDeleteAndWait(rg, vmName);
        cascaded = true;
        console.log(`[vm] cleaned up failed VM ${vmName} (cascaded NIC+disk)`);
      } catch (e) {
        if (!/NotFound|does not exist/i.test(e.message)) {
          console.warn(`[vm] VM-delete fallback failed for ${vmName}:`, e.message);
        }
      }
      if (cascaded) return;
      try {
        await network().networkInterfaces.beginDeleteAndWait(rg, `${vmName}-nic`);
        console.log(`[vm] cleaned up orphan NIC ${vmName}-nic after failed VM create`);
      } catch (e) {
        if (!/NotFound|does not exist/i.test(e.message)) {
          console.warn(`[vm] could not clean orphan NIC ${vmName}-nic:`, e.message);
        }
      }
    });
  return vmName;
}
