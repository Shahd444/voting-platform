import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config/config';
import { dataSourceOptions } from './database/data-source';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CsrfMiddleware } from './auth/csrf.middleware';
import { CoreModule } from './core/core.module';
import { DisplayController } from './display/display.controller';
import { HealthController } from './health/health.controller';
import { VisitorModule } from './visitor/visitor.module';

// Serve the built React app (frontend/dist) from the same origin in production
const frontendDist = config.frontendDist || join(__dirname, '..', '..', 'frontend', 'dist');
const staticModules = existsSync(join(frontendDist, 'index.html'))
  ? [ServeStaticModule.forRoot({
      rootPath: frontendDist,
      exclude: ['/api/{*path}', '/img/{*path}', '/healthz', '/readyz'],
      serveStaticOptions: { index: false, maxAge: config.isProd ? '1h' : 0 },
    })]
  : [];

@Module({
  imports: [
    TypeOrmModule.forRoot({ ...dataSourceOptions, migrationsRun: false }),
    ...staticModules,
    CoreModule,
    AuthModule,
    VisitorModule,
    AdminModule,
  ],
  controllers: [DisplayController, HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CsrfMiddleware).forRoutes('api/{*path}');
  }
}
