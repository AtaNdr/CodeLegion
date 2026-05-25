// Normalize a GitHub App private key that may arrive in several shapes:
//   1. Properly formatted PEM with real newlines (file upload)
//   2. PEM with literal \n sequences (App Setting paste from Key Vault tooling)
//   3. Single-line concatenated PEM (some clipboard managers strip newlines)
//
// Returns null if input is empty. Returns raw string unchanged if it already
// looks like a valid multi-line PEM.

export function normalizePrivateKey(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') raw = String(raw);

  // Already multi-line and starts with BEGIN — leave alone.
  if (raw.includes('-----BEGIN') && raw.includes('\n') && !raw.includes('\\n')) {
    return raw.endsWith('\n') ? raw : raw + '\n';
  }

  // Replace literal \n sequences (Azure Key Vault returns secrets this way).
  let key = raw.replace(/\\n/g, '\n');
  if (key.includes('\n')) {
    return key.endsWith('\n') ? key : key + '\n';
  }

  // Single-line — re-wrap the base64 body at 64 chars.
  const match = key.match(/-----BEGIN ((?:RSA )?PRIVATE KEY)-----(.+?)-----END \1-----/);
  if (!match) return raw; // can't normalize; return as-is
  const algo = match[1];
  const body = match[2].replace(/\s+/g, '');
  const wrapped = body.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${algo}-----\n${wrapped}\n-----END ${algo}-----\n`;
}
