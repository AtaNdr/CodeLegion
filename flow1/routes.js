// Flow 1 routes — read-only Phase 2 surface.
// Phase 3 adds /setup/action/:id (fix), /setup/upload-*.

import express from 'express';
import { runOne, runAll, getResults } from './runner.js';
import { checks } from './checks.js';

export const flow1Router = express.Router();

flow1Router.get('/setup', (_req, res) => {
  res.json({
    checks: checks.map(c => ({ id: c.id, label: c.label, category: c.category, fixable: !!c.fixable })),
    results: getResults(),
  });
});

flow1Router.post('/setup/check/:id', async (req, res) => {
  try {
    res.json(await runOne(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

flow1Router.post('/setup/run-all', async (_req, res) => {
  try {
    res.json(await runAll());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
