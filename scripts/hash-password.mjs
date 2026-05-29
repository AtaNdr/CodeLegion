#!/usr/bin/env node
// Hash a dashboard password locally so you can paste the result into the
// Web App's DASHBOARD_PASSWORD_HASH App Setting before deploying.
//
// Usage: node scripts/hash-password.mjs '<password>'

import { hashPassword } from '../flow2/auth.js';

const password = process.argv[2];
if (!password) {
  console.error('usage: node scripts/hash-password.mjs <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('error: password must be at least 8 characters');
  process.exit(1);
}
console.log(hashPassword(password));
