#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const mode = process.argv[2];
if (!['demo', 'event'].includes(mode)) throw new Error('Usage: node scripts/check-config.mjs demo|event');
const values = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const i = line.indexOf('=');
  return [line.slice(0, i), line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
}));
const errors = [];
if (values.COOKIE_SECURE !== 'true') errors.push('HTTPS requires COOKIE_SECURE=true');
if ((values.APP_SECRET || '').length < 32) errors.push('APP_SECRET must contain at least 32 characters');
if (!values.POSTGRES_PASSWORD) errors.push('POSTGRES_PASSWORD is required');
if (values.PUBLIC_URL && !values.PUBLIC_URL.startsWith('https://')) errors.push('PUBLIC_URL must be HTTPS or empty for automatic detection');
if (mode === 'demo') {
  if (values.SMS_PROVIDER !== 'console') errors.push('This demo profile expects console OTP');
  if (values.NODE_ENV === 'production') errors.push('On-screen demo OTP requires non-production mode');
} else {
  if (values.NODE_ENV !== 'production') errors.push('Event profile requires NODE_ENV=production');
  if (values.OTP_DEV_ECHO !== 'false') errors.push('Event profile requires OTP_DEV_ECHO=false');
  if (!values.SMS_PROVIDER || values.SMS_PROVIDER === 'console') errors.push('Unattended event delivery awaits an assigned SMS provider; console remains a supervised demo');
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`${mode} environment checks passed. Confirm saved database URL, venue access and dates in admin; physical-phone checks are still required.`);
