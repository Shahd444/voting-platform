import { DataSource } from 'typeorm';

/**
 * Run pending migrations under a PostgreSQL advisory lock, so several replicas
 * booting at the same moment never race each other.
 */
export async function runMigrationsLocked(ds: DataSource): Promise<void> {
  const qr = ds.createQueryRunner();
  await qr.connect();
  try {
    await qr.query('SELECT pg_advisory_lock(20262026)');
    await ds.runMigrations({ transaction: 'each' });
  } finally {
    await qr.query('SELECT pg_advisory_unlock(20262026)').catch(() => undefined);
    await qr.release();
  }
}
