import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from '../database/entities/admin.entity';
import { AdminAuthController, CatalogController, EventController, ReportsController } from './admin.controller';
import { AdminAuthService } from './admin-auth.service';
import { CatalogService } from './catalog.service';
import { EventService } from './event.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [TypeOrmModule.forFeature([Admin])],
  controllers: [AdminAuthController, CatalogController, EventController, ReportsController],
  providers: [AdminAuthService, CatalogService, EventService, ReportsService],
})
export class AdminModule {}
