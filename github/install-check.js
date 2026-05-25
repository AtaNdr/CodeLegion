// GitHub App installation verification helpers.

import { ghAppFetch, ghFetch } from './app.js';

export async function checkInstallation() {
  const installationId = process.env.GH_INSTALLATION_ID;
  if (!installationId) throw new Error('GH_INSTALLATION_ID not set');
  const resp = await ghAppFetch(`/app/installations/${installationId}`);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GET /app/installations/${installationId} failed: ${resp.status} ${body}`);
  }
  return resp.json();
}

export async function listInstallationRepos() {
  const resp = await ghFetch('/installation/repositories?per_page=100');
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GET /installation/repositories failed: ${resp.status} ${body}`);
  }
  const data = await resp.json();
  return data.repositories || [];
}
