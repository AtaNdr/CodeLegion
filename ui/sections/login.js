// Standalone login page — minimal, dark-mode aware, no JS framework.

import { STYLES } from '../common.js';

export function renderLoginPage({ error = null, returnTo = '/' } = {}) {
  const errorHtml = error
    ? `<div class="card err" style="margin:1rem 0">${error.replace(/[<>&]/g, '')}</div>`
    : '';
  const safeReturn = String(returnTo || '/').replace(/[<>&"]/g, '');
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>CodeLegion — Sign in</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${STYLES}
    .login-wrap { max-width: 380px; margin: 5rem auto; }
    .login-wrap h1 { font-size: 1.4rem; margin-bottom: 1.5rem; }
    .login-wrap label { display: block; margin-bottom: .35rem; color: var(--muted); font-size: .85rem; }
    .login-wrap input { margin-bottom: 1rem; }
  </style>
</head><body>
  <main class="login-wrap">
    <h1>CodeLegion</h1>
    ${errorHtml}
    <form method="POST" action="/login">
      <input type="hidden" name="return" value="${safeReturn}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit" class="primary" style="width:100%; padding:.5rem">Sign in</button>
    </form>
  </main>
</body></html>`;
}
