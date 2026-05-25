// Static-with-override pricing loader.
//   1. Load bundled v2/controller/pricing.json at boot
//   2. If PRICING_JSON App Setting is set and parses, use it as override
//   3. Cost calc reads via getPricing() — re-evaluates env on each call
//      (cheap; we want PRICING_JSON edits to take effect without restart)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_PATH = path.resolve(__dirname, '..', 'pricing.json');

let _bundled = null;
function bundled() {
  if (!_bundled) {
    _bundled = JSON.parse(fs.readFileSync(BUNDLED_PATH, 'utf8'));
  }
  return _bundled;
}

export function getPricing() {
  const override = process.env.PRICING_JSON;
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (parsed?.models) return { ...parsed, _source: 'override' };
    } catch (e) {
      console.warn('[pricing] PRICING_JSON parse failed, using bundled defaults:', e.message);
    }
  }
  return { ...bundled(), _source: 'bundled' };
}

export function calculateCost({ model, input, output, cacheCreate, cacheRead }) {
  const p = getPricing();
  const rates = p.models?.[model];
  if (!rates) return 0;
  return (Number(input || 0) * rates.input / 1_000_000)
       + (Number(output || 0) * rates.output / 1_000_000)
       + (Number(cacheCreate || 0) * (rates.cacheWrite5m || 0) / 1_000_000)
       + (Number(cacheRead || 0) * rates.cacheRead / 1_000_000);
}

export function pricingFreshness() {
  const p = getPricing();
  const lastVerified = p._lastVerified;
  if (!lastVerified) return { fresh: false, ageDays: null, source: p._source };
  const ageMs = Date.now() - new Date(lastVerified).getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return { fresh: ageDays <= 30, ageDays, lastVerified, source: p._source };
}
