// Per-VM log storage — append to a flat file per VM in /home/data/logs/.

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const LOG_DIR = path.join(config.dataDir, 'logs');

function ensureDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function fileFor(vmName) {
  // Strip anything that isn't filename-safe.
  const safe = String(vmName || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(LOG_DIR, `${safe}.log`);
}

export function appendAgentLog(vmName, agent, level, message) {
  ensureDir();
  const line = `[${new Date().toISOString()}] [${agent || '?'}] [${level || 'info'}] ${message}\n`;
  fs.appendFileSync(fileFor(vmName), line);
}

export function readAgentLog(vmName, { tail = 0 } = {}) {
  const file = fileFor(vmName);
  if (!fs.existsSync(file)) return '';
  const content = fs.readFileSync(file, 'utf8');
  if (!tail) return content;
  const lines = content.split('\n');
  return lines.slice(-tail).join('\n');
}

export function listLogs() {
  ensureDir();
  return fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).map(f => f.replace(/\.log$/, ''));
}
