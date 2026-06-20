// Shared UI helpers — escaping, pill rendering, common styles.

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function pill(status, text) {
  const cls = `pill pill-${status || 'unknown'}`;
  return `<span class="${cls}">${escapeHtml(text || status || '?')}</span>`;
}

export const STATUS_GLYPH = {
  green: '✓',
  yellow: '⚠',
  red: '✗',
  unknown: '—',
  running: '⋯',
};

export function statusDot(status) {
  return `<span class="dot dot-${status || 'unknown'}" aria-label="${escapeHtml(status || 'unknown')}"></span>`;
}

// Render `#N` as a link to the GitHub issue, opening in a new tab. Falls
// back to plain `#N` text when the repo isn't configured yet (Flow 1 not
// done) so we never produce a broken href. The CSS class .issue-link in
// STYLES below keeps the look quiet until hover.
const REPO_NAME_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
export function issueLink(n, repo, { label } = {}) {
  const text = label || ('#' + n);
  if (!n || !repo || !REPO_NAME_RE.test(repo)) return escapeHtml(text);
  return `<a href="https://github.com/${repo}/issues/${encodeURIComponent(n)}" target="_blank" rel="noopener" class="issue-link">${escapeHtml(text)}</a>`;
}

export function currentRepo() {
  const o = process.env.GH_REPO_OWNER;
  const r = process.env.GH_REPO_NAME;
  return o && r ? `${o}/${r}` : null;
}

export const STYLES = `
  /* Theme — light variables on :root, dark override via @media for auto-
     follow. Explicit overrides via html[data-theme="…"] win against the
     media query because they're more specific. With no data-theme attribute
     set, the page tracks the OS preference (the "auto" behaviour). The
     header sun/moon toggle writes data-theme to localStorage; clearing
     storage reverts to auto. */
  :root { color-scheme: light dark;
    --fg:#222; --bg:#fff; --muted:#888; --border:#e0e0e0; --pill-bg:#f0f0f0;
    --err:#c33; --warn:#a60; --ok:#161; --info:#247;
    --green:#0a7d3a; --yellow:#a36500; --red:#b3261e; --grey:#888;
  }
  @media (prefers-color-scheme: dark) { :root {
    --fg:#eee; --bg:#1b1b1b; --muted:#999; --border:#333; --pill-bg:#2a2a2a;
    --err:#f66; --warn:#fc6; --ok:#6c9; --info:#7af;
    --green:#4caf50; --yellow:#f0b400; --red:#ef5350; --grey:#999;
  } }
  html[data-theme="light"] { color-scheme: light;
    --fg:#222; --bg:#fff; --muted:#888; --border:#e0e0e0; --pill-bg:#f0f0f0;
    --err:#c33; --warn:#a60; --ok:#161; --info:#247;
    --green:#0a7d3a; --yellow:#a36500; --red:#b3261e; --grey:#888;
  }
  html[data-theme="dark"] { color-scheme: dark;
    --fg:#eee; --bg:#1b1b1b; --muted:#999; --border:#333; --pill-bg:#2a2a2a;
    --err:#f66; --warn:#fc6; --ok:#6c9; --info:#7af;
    --green:#4caf50; --yellow:#f0b400; --red:#ef5350; --grey:#999;
  }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 1.5rem; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem 0; }
  h2 { font-size: 1.05rem; margin: 1.5rem 0 .5rem 0; font-weight: 600; }
  h3 { font-size: .95rem; margin: 0 0 .5rem 0; font-weight: 600; color: var(--muted); }
  a { color: var(--info); }
  .muted { color: var(--muted); }
  .err { color: var(--err); }
  .warn { color: var(--warn); }
  .ok { color: var(--ok); }
  .row { display: flex; gap: .5rem; align-items: center; }
  .spread { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
  .card { border: 1px solid var(--border); border-radius: 6px; padding: 1rem; margin: .5rem 0; }
  .grid { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td, tr:last-child th { border-bottom: none; }
  th { font-weight: 600; color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  code { font: .85em/1 ui-monospace, "SF Mono", Menlo, monospace; background: var(--pill-bg); padding: 2px 6px; border-radius: 3px; }
  ul { margin: .25rem 0 .25rem 1.2rem; padding: 0; }
  li { margin: .15rem 0; }
  .empty { color: var(--muted); font-style: italic; }
  details > summary { cursor: pointer; user-select: none; }
  button { font: inherit; padding: .3rem .75rem; border: 1px solid var(--border); background: var(--pill-bg); color: var(--fg); border-radius: 4px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--border); }
  button:disabled { opacity: .5; cursor: progress; }
  button.primary { background: var(--info); color: white; border-color: var(--info); }
  button.primary:hover:not(:disabled) { filter: brightness(.9); background: var(--info); }
  button.danger { background: var(--err); color: white; border-color: var(--err); }
  input[type=text], input[type=password], textarea { font: inherit; padding: .4rem; border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 4px; width: 100%; }
  textarea { font: .85em ui-monospace, monospace; min-height: 120px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .8rem; font-weight: 500; background: var(--pill-bg); color: var(--fg); }
  .pill-green  { background: color-mix(in srgb, var(--green) 25%, transparent); color: var(--green); }
  .pill-yellow { background: color-mix(in srgb, var(--yellow) 25%, transparent); color: var(--yellow); }
  .pill-red    { background: color-mix(in srgb, var(--red) 25%, transparent); color: var(--red); }
  .pill-running{ background: color-mix(in srgb, var(--info) 20%, transparent); color: var(--info); }
  .pill-unknown{ background: var(--pill-bg); color: var(--muted); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--grey); vertical-align: middle; flex-shrink: 0; }
  .dot-green  { background: var(--green); }
  .dot-yellow { background: var(--yellow); }
  .dot-red    { background: var(--red); }
  .dot-running{ background: var(--info); animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .4 } }
  footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .85rem; }

  /* Toasts */
  #toast-container { position: fixed; bottom: 1rem; right: 1rem; display: flex; flex-direction: column; gap: .5rem; z-index: 1000; max-width: min(380px, calc(100vw - 2rem)); }
  .toast { display: flex; align-items: center; gap: .55rem; padding: .6rem .9rem; border-radius: 6px; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-left-width: 3px; box-shadow: 0 4px 16px rgba(0,0,0,.25); font-size: .9rem; opacity: 0; transform: translateY(10px); transition: opacity .25s ease, transform .25s ease; }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast-success { border-left-color: var(--green); }
  .toast-error   { border-left-color: var(--red); }
  .toast-loading { border-left-color: var(--info); }
  .toast-info    { border-left-color: var(--info); }
  .spinner { width: 15px; height: 15px; border: 2px solid var(--border); border-top-color: var(--info); border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Issue links — quiet by default, underline on hover. */
  .issue-link { color: var(--info); text-decoration: none; }
  .issue-link:hover { text-decoration: underline; }

  /* Update-available pill briefly pulses on first render, then settles. */
  .update-pulse { animation: update-pulse 1s ease-in-out 0s 4; }
  @keyframes update-pulse {
    0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--yellow) 50%, transparent); }
    50%     { box-shadow: 0 0 0 6px color-mix(in srgb, var(--yellow) 0%,  transparent); }
  }

  /* ─────────── App header (top bar) ─────────── */
  .app-header {
    position: sticky; top: 0; z-index: 50;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
    margin-bottom: 1.25rem;
  }
  .app-header-inner {
    max-width: 1100px; margin: 0 auto;
    padding: .65rem 1.5rem;
    display: flex; align-items: center; gap: .75rem;
  }
  .brand-block { display: flex; align-items: center; gap: .55rem; min-width: 0; }
  .brand-mark {
    width: 26px; height: 26px;
    display: inline-flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, var(--info), color-mix(in srgb, var(--info) 60%, var(--fg)));
    color: #fff; border-radius: 6px;
    font: 700 11px ui-monospace, monospace; letter-spacing: 1px;
    flex-shrink: 0;
  }
  .brand-name { font-weight: 600; font-size: 1rem; }
  .brand-version { font-size: .78rem; color: var(--muted); font-family: ui-monospace, monospace; }

  .header-icons { margin-left: auto; display: flex; align-items: center; gap: .35rem; }
  .icon-btn {
    position: relative;
    width: 36px; height: 36px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; color: var(--fg);
    border: 1px solid transparent;
    border-radius: 8px; cursor: pointer; padding: 0;
    transition: background .15s, border-color .15s;
  }
  .icon-btn:hover { background: var(--pill-bg); border-color: var(--border); }
  .icon-btn[aria-expanded="true"] { background: var(--pill-bg); border-color: var(--border); }
  .icon-btn-avatar {
    background: linear-gradient(135deg, var(--info), color-mix(in srgb, var(--info) 60%, var(--fg)));
    color: #fff;
  }
  .icon-btn-avatar:hover { filter: brightness(1.08); }
  .avatar-initials { font-weight: 700; font-size: .85rem; }
  .icon-badge {
    position: absolute; top: 2px; right: 2px;
    min-width: 16px; height: 16px; padding: 0 4px;
    background: var(--red); color: #fff;
    border-radius: 999px;
    font: 700 10px/16px ui-sans-serif, system-ui, sans-serif;
    text-align: center;
    border: 2px solid var(--bg);
    box-sizing: content-box;
  }
  #notifIconBtn .icon-badge { background: var(--info); }

  /* Theme-toggle icon — show whichever icon matches the *current effective*
     theme (light → sun, dark → moon). Clicking flips to the other. Auto
     mode (no data-theme attribute) tracks the system preference via the
     prefers-color-scheme media query. */
  #themeIconBtn .theme-sun,
  #themeIconBtn .theme-moon { display: none; }
  html:not([data-theme]) #themeIconBtn .theme-sun { display: block; }
  @media (prefers-color-scheme: dark) {
    html:not([data-theme]) #themeIconBtn .theme-sun { display: none; }
    html:not([data-theme]) #themeIconBtn .theme-moon { display: block; }
  }
  html[data-theme="light"] #themeIconBtn .theme-sun { display: block; }
  html[data-theme="light"] #themeIconBtn .theme-moon { display: none; }
  html[data-theme="dark"]  #themeIconBtn .theme-moon { display: block; }
  html[data-theme="dark"]  #themeIconBtn .theme-sun { display: none; }
  #themeIconBtn:hover { transform: rotate(15deg); transition: transform .15s, background .15s, border-color .15s; }

  /* ─────────── Large dialog modals (Infrastructure setup, Environment) ─────────── */
  dialog.modal-lg {
    width: min(960px, 92vw);
    max-height: 86vh;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 16px 48px rgba(0,0,0,.35);
    overflow: hidden;
  }
  dialog.modal-lg::backdrop { background: rgba(0,0,0,.45); }
  dialog.modal-lg[open] { display: flex; flex-direction: column; }
  .modal-header {
    flex-shrink: 0;
    padding: .9rem 1.1rem;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    background: var(--bg);
    position: sticky; top: 0; z-index: 1;
  }
  .modal-header h2 { font-size: 1rem; margin: 0; font-weight: 600; }
  .modal-close, .np-close {
    width: 30px; height: 30px;
    background: transparent; border: 1px solid var(--border);
    color: var(--fg); border-radius: 6px;
    font-size: 1.1rem; line-height: 1; cursor: pointer; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    transition: background .15s;
  }
  .modal-close:hover, .np-close:hover { background: var(--pill-bg); }
  .modal-body { flex: 1; overflow-y: auto; padding: 1rem 1.1rem 1.5rem; }
  .modal-body > details > summary > h2 { font-size: 1rem; }

  /* ─────────── Notifications popover + User popover ─────────── */
  .notifications-panel, .user-popover {
    position: fixed; top: 56px; right: 1rem;
    width: min(380px, calc(100vw - 2rem));
    max-height: calc(100vh - 80px);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0,0,0,.35);
    z-index: 180;
    display: flex; flex-direction: column;
    opacity: 0; transform: translateY(-6px);
    transition: opacity .18s, transform .18s;
    pointer-events: none;
  }
  .notifications-panel.open, .user-popover.open {
    opacity: 1; transform: translateY(0);
    pointer-events: all;
  }
  .notifications-panel[hidden], .user-popover[hidden] { display: flex !important; }
  .np-header {
    padding: .75rem 1rem;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    flex-shrink: 0;
  }
  .np-list { list-style: none; padding: 0; margin: 0; overflow-y: auto; max-height: 60vh; }
  .np-empty { padding: 1.5rem 1rem; color: var(--muted); text-align: center; font-size: .9rem; }
  .note {
    display: flex; align-items: flex-start; gap: .5rem;
    padding: .75rem 1rem;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid var(--border);
  }
  .note:last-child { border-bottom: none; }
  .note-tier-action { border-left-color: var(--red); }
  .note-tier-warn   { border-left-color: var(--yellow); }
  .note-tier-info   { border-left-color: var(--info); }
  .note-body { flex: 1; min-width: 0; }
  .note-title { font-weight: 600; font-size: .9rem; margin-bottom: 2px; }
  .note-text { font-size: .82rem; color: var(--muted); line-height: 1.45; word-wrap: break-word; }
  .note-action {
    margin-top: .5rem;
    padding: .3rem .75rem;
    background: var(--info); color: #fff; border: none;
    border-radius: 5px; cursor: pointer; font-size: .8rem; font-weight: 600;
    transition: filter .15s;
  }
  .note-action:hover { filter: brightness(1.1); }
  .note-dismiss {
    width: 22px; height: 22px; flex-shrink: 0;
    background: transparent; border: none; color: var(--muted);
    cursor: pointer; font-size: 1rem; line-height: 1; padding: 0;
    border-radius: 4px; transition: background .15s, color .15s;
  }
  .note-dismiss:hover { background: var(--pill-bg); color: var(--fg); }
  .np-footer {
    padding: .55rem 1rem;
    border-top: 1px solid var(--border);
    text-align: center;
    flex-shrink: 0;
  }
  .link-btn {
    background: none; border: none; color: var(--info);
    font-size: .82rem; cursor: pointer; padding: 0;
    text-decoration: none;
  }
  .link-btn:hover { text-decoration: underline; }

  .up-body { padding: 1rem; text-align: center; }
  .up-avatar {
    width: 48px; height: 48px;
    margin: 0 auto .5rem;
    display: inline-flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, var(--info), color-mix(in srgb, var(--info) 60%, var(--fg)));
    color: #fff; border-radius: 50%;
    font-weight: 700; font-size: 1.1rem;
  }
  .up-status { font-weight: 600; font-size: .9rem; margin-bottom: .5rem; }
  .up-note { font-size: .8rem; color: var(--muted); margin-bottom: .75rem; line-height: 1.45; }
`;
