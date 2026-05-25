// Cost storage — JSONL on the Web App's persistent disk.
// Each line is a cost record: { timestamp, agent, model, issue, kind, input,
// output, cacheCreate, cacheRead, durationSeconds, cost }.

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { calculateCost } from '../anthropic/pricing.js';

const COST_LOG = path.join(config.dataDir, 'cost.jsonl');

function ensureDir() {
  fs.mkdirSync(path.dirname(COST_LOG), { recursive: true });
}

export function appendCostRecord(record) {
  ensureDir();
  fs.appendFileSync(COST_LOG, JSON.stringify(record) + '\n');
}

export function readAll() {
  if (!fs.existsSync(COST_LOG)) return [];
  return fs.readFileSync(COST_LOG, 'utf8')
    .split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

export function readRecent(n = 20) {
  return readAll().slice(-n).reverse();
}

export function todayMonthTotals() {
  const reports = readAll();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const sum = (arr, key = 'cost') => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const tokenSum = (arr) => arr.reduce((s, r) => s + (r.input || 0) + (r.output || 0) + (r.cacheCreate || 0) + (r.cacheRead || 0), 0);

  const today = reports.filter(r => new Date(r.timestamp).getTime() >= startOfDay);
  const month = reports.filter(r => new Date(r.timestamp).getTime() >= startOfMonth);

  const byModelMonth = {};
  for (const model of ['haiku', 'sonnet', 'opus']) {
    byModelMonth[model] = { cost: sum(month.filter(r => r.model === model)) };
  }

  return {
    today: { cost: sum(today), tokens: tokenSum(today), count: today.length },
    month: { cost: sum(month), tokens: tokenSum(month), count: month.length },
    byModelMonth,
  };
}

export function buildCostRecord({ agent, model, issue, kind, input, output, cacheCreate, cacheRead, durationSeconds }) {
  const cost = calculateCost({ model, input, output, cacheCreate, cacheRead });
  return {
    timestamp: new Date().toISOString(),
    agent, model, issue, kind: kind || 'task',
    input: Number(input || 0),
    output: Number(output || 0),
    cacheCreate: Number(cacheCreate || 0),
    cacheRead: Number(cacheRead || 0),
    durationSeconds: Number(durationSeconds || 0),
    cost,
  };
}

export { calculateCost };
