// Lazy-initialized Azure ARM clients.
//
// Lazy because we want the server to boot even when AZURE_SUBSCRIPTION_ID is
// unset — the Flow 1 wizard needs to come up and tell the user what's missing,
// not crash on startup.

import { DefaultAzureCredential } from '@azure/identity';
import { ComputeManagementClient } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { ResourceManagementClient } from '@azure/arm-resources';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { config } from '../config.js';

let _credential = null;
function credential() {
  if (!_credential) _credential = new DefaultAzureCredential();
  return _credential;
}

const _clients = {};
function lazy(key, Ctor) {
  if (!_clients[key]) {
    if (!config.subscriptionId) {
      throw new Error('AZURE_SUBSCRIPTION_ID is not set');
    }
    _clients[key] = new Ctor(credential(), config.subscriptionId);
  }
  return _clients[key];
}

export const compute = () => lazy('compute', ComputeManagementClient);
export const network = () => lazy('network', NetworkManagementClient);
export const resources = () => lazy('resources', ResourceManagementClient);
export const appservice = () => lazy('appservice', WebSiteManagementClient);
