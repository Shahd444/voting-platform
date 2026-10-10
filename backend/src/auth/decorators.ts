import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AdminRole } from '../database/entities/admin.entity';
import { normalizeIp } from '../common/geo.util';

export const ROLES_KEY = 'roles';
/** Restrict an admin route to roles (default: any admin role). */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthedAdmin { id: number; username: string; role: AdminRole; totp_enabled: boolean }

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthedAdmin => ctx.switchToHttp().getRequest().admin);
export const VisitorId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest().visitorId);
/** Client IP as resolved by Express `trust proxy` (the on-site check depends on it). */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string =>
  normalizeIp(ctx.switchToHttp().getRequest().ip));
