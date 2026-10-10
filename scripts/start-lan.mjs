#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const env = { ...process.env, HTTP_BIND: '127.0.0.1', HTTP_PORT: '3000', REAL_IP_CONF: 'real-ip.lan.conf' };
const check = spawnSync('docker', ['compose', 'version'], { env, stdio: 'ignore' });
if (check.error || check.status !== 0) {
  console.error('Docker with Compose is required. Install/start Docker Desktop, then retry.');
  process.exit(1);
}
const result = spawnSync('docker', ['compose', 'up', '-d', '--build', '--wait'], { env, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const gateway = spawn(process.execPath, ['scripts/lan-gateway.mjs'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => gateway.kill(signal));
gateway.on('exit', code => process.exit(code || 0));
