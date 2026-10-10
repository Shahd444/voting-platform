import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AppError } from '../common/http-error';
import { Admin, type AdminRole } from '../database/entities/admin.entity';
import { SettingsService } from '../settings/settings.service';
import { AuthedAdmin, ROLES_KEY } from './decorators';
import { SessionService } from './session.service';

/** Loads the admin from the mc_a cookie, rejecting tokens whose version no longer matches. */
@Injectable()
export class AdminLoader {
  constructor(private readonly sessions: SessionService, @InjectRepository(Admin) private readonly admins: Repository<Admin>) {}

  async load(req: Request): Promise<AuthedAdmin | null> {
    const p = this.sessions.read(req, 'mc_a', 'admin');
    if (!p) return null;
    const a = await this.admins.findOne({ where: { id: Number(p.sub) } });
    if (!a || SessionService.tokenVersion(a.passwordHash) !== p.tv) return null;
    return { id: a.id, username: a.username, role: a.role, totp_enabled: a.totpEnabled };
  }
}

@Injectable()
export class VisitorGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const p = this.sessions.read(req, 'mc_v', 'visitor');
    if (!p) throw new AppError(401, 'not_verified', 'Please verify your phone number first.');
    req.visitorId = p.sub;
    return true;
  }
}

/** Requires an authenticated admin; @Roles('admin') narrows it to full admins. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly loader: AdminLoader, private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const admin = await this.loader.load(req);
    if (!admin) throw new AppError(401, 'unauthorized', 'Please sign in.');
    const roles = this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) || ['admin', 'viewer'];
    if (!roles.includes(admin.role)) throw new AppError(403, 'forbidden', 'Your account is read-only.');
    req.admin = admin;
    return true;
  }
}

/** Live results: display cookie bound to the current display key, or any admin session. */
@Injectable()
export class DisplayOrAdminGuard implements CanActivate {
  constructor(private readonly sessions: SessionService, private readonly settings: SettingsService, private readonly loader: AdminLoader) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    return this.authorize(req);
  }

  async authorize(req: Request) {
    const d = this.sessions.read(req, 'mc_d', 'display');
    if (d) {
      const s = await this.settings.getAll();
      if (s.display.key && d.kv === SessionService.displayKeyVersion(s.display.key)) return true;
    }
    if (await this.loader.load(req)) return true;
    throw new AppError(401, 'display_key_required', 'This screen is protected.');
  }
}
