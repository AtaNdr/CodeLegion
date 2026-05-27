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

export const STYLES = `
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
`;
