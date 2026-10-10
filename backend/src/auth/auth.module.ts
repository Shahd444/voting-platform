import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from '../database/entities/admin.entity';
import { AdminGuard, AdminLoader, DisplayOrAdminGuard, VisitorGuard } from './guards';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Admin])],
  providers: [SessionService, AdminLoader, AdminGuard, VisitorGuard, DisplayOrAdminGuard],
  exports: [SessionService, AdminLoader, AdminGuard, VisitorGuard, DisplayOrAdminGuard],
})
export class AuthModule {}
