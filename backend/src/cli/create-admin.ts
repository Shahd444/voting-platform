/** Usage: npm run create-admin -- <username> <password(>=10 chars)> [admin|viewer] */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { hashPassword } from '../common/crypto.util';
import { dataSourceOptions } from '../database/data-source';
import { runMigrationsLocked } from '../database/migrate';

async function main() {
  const [username, password, role = 'admin'] = process.argv.slice(2);
  if (!username || !password || password.length < 10) {
    console.error('Usage: npm run create-admin -- <username> <password(>=10 chars)> [admin|viewer]');
    process.exit(1);
  }
  const ds = await new DataSource(dataSourceOptions).initialize();
  await runMigrationsLocked(ds);
  await ds.query(
    `INSERT INTO admins (username, password_hash, role) VALUES ($1,$2,$3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, failed_logins = 0, locked_until = NULL`,
    [username.toLowerCase(), await hashPassword(password), role === 'viewer' ? 'viewer' : 'admin']);
  console.log(`Admin "${username}" saved.`);
  await ds.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
