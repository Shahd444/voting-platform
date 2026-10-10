// Container runner: mount backend at /verification and this file in /app/api.
// Credentials come from the container environment; application data is never reset.
const { DataSource } = require('typeorm');
const { spawn } = require('node:child_process');
async function main() {
  const control = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL }).initialize();
  const database = `atomic_tests_${Date.now()}`;
  try {
    await control.query(`CREATE DATABASE "${database}"`);
    const url = new URL(process.env.DATABASE_URL); url.pathname = `/${database}`;
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['/verification/node_modules/jest/bin/jest.js', '--runInBand', ...process.argv.slice(2)], {
        cwd: '/verification', stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url.toString(), TZ: 'UTC' },
      });
      child.on('error', reject); child.on('exit', resolve);
    });
    if (code !== 0) throw new Error(`Tests exited with code ${code}`);
  } finally {
    await control.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await control.destroy();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
