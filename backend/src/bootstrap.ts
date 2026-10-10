import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { DataSource } from 'typeorm';
import { config } from './config/config';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AuditService } from './core/audit.service';
import { hashPassword } from './common/crypto.util';
import { runMigrationsLocked } from './database/migrate';
import { SettingsService } from './settings/settings.service';

/** Shared HTTP setup — used by main.ts and by the e2e tests. */
export function configureApp(app: NestExpressApplication, trustProxy: string | number | boolean = config.trustProxy) {
  // req.ip must be the real client IP behind nginx / a load balancer — the on-site check depends on it
  app.set('trust proxy', typeof trustProxy === 'string' && /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    strictTransportSecurity: config.cookieSecure,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '50kb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(AuditService)));
  app.enableShutdownHooks();
  return app;
}

/** Migrations (advisory-locked) → default settings → first admin. Safe on every replica boot. */
export async function prepareDatabase(app: INestApplication) {
  const log = new Logger('Bootstrap');
  const ds = app.get(DataSource);
  await runMigrationsLocked(ds);
  await app.get(SettingsService).ensureDefaults();
  await ds.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(20262027)');
    const n = (await manager.query('SELECT COUNT(*)::int AS n FROM admins'))[0].n;
    if (n === 0) {
      const { username, password } = config.bootstrapAdmin;
      if (!password) {
        log.warn('No admin exists and ADMIN_PASSWORD is not set — create one with `npm run create-admin`');
      } else {
        await manager.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING', [username.toLowerCase(), await hashPassword(password)]);
        log.log(`bootstrap admin "${username}" created`);
      }
    }
  });
}
