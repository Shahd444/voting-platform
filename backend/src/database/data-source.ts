import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from '../config/config';
import { ENTITIES } from './entities';
import { Init1759600000000 } from './migrations/1759600000000-Init';
import { ExhibitorCategoryIdentity1791370000000 } from './migrations/1791370000000-ExhibitorCategoryIdentity';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: config.databaseUrl,
  entities: ENTITIES,
  migrations: [Init1759600000000, ExhibitorCategoryIdentity1791370000000],
  migrationsTableName: 'schema_migrations',
  synchronize: false, // schema is owned by migrations, never auto-synced
  extra: { max: config.dbPoolSize, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 },
};

/** Used by the TypeORM CLI: `npx typeorm -d dist/database/data-source.js migration:run` */
export default new DataSource(dataSourceOptions);
