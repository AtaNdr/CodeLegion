// /agent/secrets — VMs fetch their runtime secrets from here.
//
// Replaces v1's with-secrets.sh + Key Vault dance. The controller already
// has all the secrets in its App Settings; it mints a fresh GH installation
// token per call so the GH App private key never leaves the controller.

import { getInstallationToken } from '../github/app.js';

export async function buildSecretsResponse() {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not set in controller');

  const githubToken = await getInstallationToken();
  const owner = process.env.GH_REPO_OWNER;
  const repo = process.env.GH_REPO_NAME;
  const repoUrl = owner && repo ? `https://github.com/${owner}/${repo}.git` : null;

  return {
    anthropicApiKey,
    githubToken,
    repoUrl,
  };
}
