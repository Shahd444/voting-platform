#!/usr/bin/env node
// Never restores over the application database. Verification uses a temporary database.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
async function docker(args, input, output) {
  const child = spawn('docker', ['compose', 'exec', '-T', 'db', ...args], { stdio: ['pipe', 'pipe', 'inherit'] });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Database command failed (${code})`))); });
  let text = '';
  if (!output) child.stdout.on('data', data => { text += data; });
  const streams = [];
  if (input) streams.push(pipeline(createReadStream(input), child.stdin)); else child.stdin.end();
  if (output) streams.push(pipeline(child.stdout, createWriteStream(output, { flags: 'wx' })));
  await Promise.all([done, ...streams]);
  return text.trim();
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const mode = process.argv[2];
if (mode === 'backup') {
  await mkdir('backups', { recursive: true });
  const file = path.resolve('backups', `mc2026-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  try {
    await docker(['pg_dump', '-U', 'mc', '-d', 'mc2026', '-Fc', '--no-owner'], null, file);
    await writeFile(`${file}.json`, JSON.stringify({ createdAt: new Date().toISOString(), sha256: await digest(file), format: 'PostgreSQL custom archive' }, null, 2));
    console.log(`Backup created: ${file}\nVerify: node scripts/db-recovery.mjs verify "${file}"`);
  } catch (error) { await unlink(file).catch(() => {}); throw error; }
} else if (mode === 'verify' && process.argv[3]) {
  const file = path.resolve(process.argv[3]);
  const manifest = JSON.parse(await readFile(`${file}.json`, 'utf8'));
  if (await digest(file) !== manifest.sha256) throw new Error('Backup checksum mismatch');
  const database = `verify_restore_${randomUUID().replaceAll('-', '')}`;
  await docker(['createdb', '-U', 'mc', database]);
  try {
    await docker(['pg_restore', '-U', 'mc', '-d', database, '--exit-on-error', '--no-owner', '--no-privileges'], file);
    const tables = await docker(['psql', '-U', 'mc', '-d', database, '-Atc', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"]);
    if (Number(tables) < 10) throw new Error(`Incomplete schema: ${tables} tables`);
    await docker(['psql', '-U', 'mc', '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', 'SELECT count(*) FROM votes; SELECT count(*) FROM settings;']);
    console.log(`Restore verified: checksum, archive, schema (${tables} tables), votes and settings readable. Live database untouched.`);
  } finally { await docker(['dropdb', '-U', 'mc', database]); }
} else { throw new Error('Usage: node scripts/db-recovery.mjs backup | verify <dump-file>'); }
