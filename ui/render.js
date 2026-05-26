// Top-level HTML page renderer. Composes sections.

import { config } from '../config.js';
import { escapeHtml, STYLES } from './common.js';
import { renderSetup } from './sections/setup.js';
import { renderDiscovery } from './sections/discovery.js';
import { INLINE_SCRIPT } from './script.js';

export function renderPage({ phase1, discovery, missing, topError, fleet, cost, version }) {
  const setupSection = phase1 ? renderSetup(phase1) : '';
  const discoverySection = discovery ? renderDiscovery({ discovery, missing, topError }) : '';
  const fleetSection = fleet || '';
  const costSection = cost || '';

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>CodeLegion</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- Auto-refresh handled in JS so we can skip while a modal is open. -->

  <style>${STYLES}</style>
</head><body>
<main>
  <h1>CodeLegion <span class="muted">v${escapeHtml(version || config.version)}</span></h1>
  ${setupSection}
  ${fleetSection}
  ${costSection}
  ${discoverySection}
  <footer>
    <a href="/api/state">/api/state</a> ·
    <a href="/setup">/setup</a> ·
    <a href="/fleet">/fleet</a> ·
    <a href="/cost/summary">/cost/summary</a> ·
    <a href="/api/discovery">/api/discovery</a> ·
    <a href="/health">/health</a>
  </footer>

  <dialog id="timeline-modal">
    <div class="spread"><h3 id="timeline-title" style="margin:0">Timeline</h3>
      <button onclick="document.getElementById('timeline-modal').close()">Close</button></div>
    <pre id="timeline-body" style="font: .8rem ui-monospace, monospace; max-height: 60vh; overflow:auto; margin-top:.5rem"></pre>
  </dialog>
</main>
<script>${INLINE_SCRIPT}</script>
</body></html>`;
}
