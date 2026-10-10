import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, prepareDatabase } from './bootstrap';
import { config } from './config/config';

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  await prepareDatabase(app);
  const server = await app.listen(config.port);
  server.keepAliveTimeout = 65_000; // > typical load-balancer idle timeout
  server.headersTimeout = 66_000;
  new Logger('Main').log(`MC2026 voting API listening on :${config.port}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('fatal startup error', e);
  process.exit(1);
});
