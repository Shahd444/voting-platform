import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as QRCode from 'qrcode';
import type { Response } from 'express';
import { EntityManager, Repository } from 'typeorm';
import { config } from '../config/config';
import { decrypt, encrypt, hashPassword, verifyPassword } from '../common/crypto.util';
import { AppError } from '../common/http-error';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../common/totp.util';
import { AuthedAdmin } from '../auth/decorators';
import { SessionService } from '../auth/session.service';
import { AuditService } from '../core/audit.service';
import { Admin } from '../database/entities/admin.entity';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 5;
// Valid-format hash of a random password: keeps login timing identical for unknown users
const DUMMY_HASH = 'scrypt$16384$8$1$c29tZXNhbHRzb21lc2FsdA==$' + Buffer.alloc(64).toString('base64');

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  private locked<T>(id: number, work: (row: Admin, repo: Repository<Admin>, manager: EntityManager) => Promise<T>) {
    return this.admins.manager.transaction(async manager => {
      const repo = manager.getRepository(Admin);
      const row = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new AppError(401, 'unauthorized', 'Please sign in.');
      return work(row, repo, manager);
    });
  }

  async login(res: Response, ip: string, usernameRaw: string, password: string) {
    const username = String(usernameRaw || '').trim().toLowerCase();
    const outcome = await this.admins.manager.transaction(async manager => {
      const repo = manager.getRepository(Admin);
      const a = await repo.findOne({ where: { username }, lock: { mode: 'pessimistic_write' } });
      if (a?.lockedUntil && a.lockedUntil > new Date()) {
        throw new AppError(423, 'locked', 'Account temporarily locked after failed attempts. Try again later.', {
          retryAfter: Math.ceil((a.lockedUntil.getTime() - Date.now()) / 1000),
        });
      }
      const ok = await verifyPassword(password, a ? a.passwordHash : DUMMY_HASH);
      if (!a || !ok) {
        if (a) {
          a.failedLogins += 1;
          if (a.failedLogins >= LOCK_AFTER) a.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
          await repo.save(a);
        }
        await this.audit.record(`admin:${username || '?'}`, 'login_failed', {}, ip, manager);
        return { error: new AppError(401, 'bad_credentials', 'Incorrect username or password.',
            a?.lockedUntil && a.lockedUntil > new Date()
              ? { accountLocked: true, retryAfter: Math.ceil((a.lockedUntil.getTime() - Date.now()) / 1000) } : undefined) };
      }
      if (a.totpEnabled) {
        const payload = { sub: a.id, typ: 'admin_pending' as const, tv: SessionService.tokenVersion(a.passwordHash) };
        const mfaToken = this.sessions.sign(payload, '5m');
        return { mfaRequired: true as const, mfaToken, payload };
      }
      const accessToken = await this.complete(ip, a, repo, manager);
      return { ok: true as const, accessToken, payload: this.payload(a), mfaSetupRecommended: true };
    });
    if ('error' in outcome) throw outcome.error;
    if ('mfaRequired' in outcome) {
      this.sessions.set(res, 'mc_ap', outcome.payload, '5m');
      return { mfaRequired: true, mfaToken: outcome.mfaToken };
    }
    this.sessions.set(res, 'mc_a', outcome.payload, config.sessions.adminTtl);
    return { ok: true, accessToken: outcome.accessToken, mfaSetupRecommended: true };
  }

  async loginMfa(res: Response, ip: string, pending: { sub?: string | number; tv?: string } | null, code: string) {
    if (!pending) throw new AppError(401, 'mfa_expired', 'Please sign in again.');
    const outcome = await this.locked(Number(pending.sub), async (a, repo, manager) => {
      if (!a || !a.totpEnabled || !a.totpSecretEnc || SessionService.tokenVersion(a.passwordHash) !== pending.tv) throw new AppError(401, 'mfa_expired', 'Please sign in again.');
      if (!verifyTotp(decrypt(a.totpSecretEnc), String(code || '').trim())) {
        a.failedLogins += 1;
        await repo.save(a);
        await this.audit.record(`admin:${a.username}`, 'mfa_failed', {}, ip, manager);
        return { error: new AppError(401, 'bad_code', 'Incorrect authenticator code.') };
      }
      const accessToken = await this.complete(ip, a, repo, manager);
      return { accessToken, payload: this.payload(a) };
    });
    if ('error' in outcome) throw outcome.error;
    this.sessions.clear(res, 'mc_ap');
    this.sessions.set(res, 'mc_a', outcome.payload, config.sessions.adminTtl);
    return { ok: true, accessToken: outcome.accessToken };
  }

  private payload(a: Admin) {
    return { sub: a.id, typ: 'admin' as const, role: a.role, tv: SessionService.tokenVersion(a.passwordHash) };
  }

  async verifyCurrentPassword(admin: AuthedAdmin, password: string) {
    const row = await this.admins.findOne({ where: { id: admin.id } });
    if (!row || !(await verifyPassword(String(password || ''), row.passwordHash))) {
      throw new AppError(401, 'bad_credentials', 'Current password is incorrect.');
    }
  }

  private async complete(ip: string, a: Admin, repo: Repository<Admin>, manager: EntityManager) {
    a.failedLogins = 0;
    a.lockedUntil = null;
    a.lastLoginAt = new Date();
    await repo.save(a);
    const payload = this.payload(a);
    const accessToken = this.sessions.sign(payload, config.sessions.adminTtl);
    await this.audit.record(`admin:${a.username}`, 'login', { mfa: a.totpEnabled }, ip, manager);
    return accessToken;
  }

  async changePassword(res: Response, ip: string, admin: AuthedAdmin, current: string, next: string) {
    if (typeof next !== 'string' || next.length < 10) throw new AppError(400, 'weak_password', 'New password must be at least 10 characters.');
    const hash = await hashPassword(next);
    const payload = await this.locked(admin.id, async (row, repo, manager) => {
      if (!(await verifyPassword(String(current || ''), row.passwordHash))) throw new AppError(401, 'bad_credentials', 'Current password is incorrect.');
      row.passwordHash = hash;
      await repo.save(row);
      await this.audit.record(`admin:${admin.username}`, 'password_changed', {}, ip, manager);
      return this.payload(row);
    });
    // New token version -> every other session is revoked; keep this one alive
    const accessToken = this.sessions.sign(payload, config.sessions.adminTtl);
    this.sessions.set(res, 'mc_a', payload, config.sessions.adminTtl);
    return { ok: true, accessToken };
  }

  async mfaSetup(admin: AuthedAdmin) {
    return this.locked(admin.id, async (row, repo) => {
      if (row.totpEnabled) throw new AppError(400, 'mfa_already_enabled', 'MFA is already enabled.');
      const secret = row.totpSecretEnc ? decrypt(row.totpSecretEnc) : generateTotpSecret();
      const url = otpauthUrl(secret, admin.username);
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
      row.totpSecretEnc = encrypt(secret);
      await repo.save(row);
      return { secret, otpauth: url, qr };
    });
  }

  async mfaEnable(ip: string, admin: AuthedAdmin, code: string) {
    return this.locked(admin.id, async (row, repo, manager) => {
      if (!row.totpSecretEnc) throw new AppError(400, 'mfa_not_setup', 'Start MFA setup first.');
      if (!verifyTotp(decrypt(row.totpSecretEnc), String(code || '').trim())) throw new AppError(400, 'bad_code', 'Incorrect code — check your authenticator app and try again.');
      row.totpEnabled = true;
      await repo.save(row);
      await this.audit.record(`admin:${admin.username}`, 'mfa_enabled', {}, ip, manager);
      return { ok: true };
    });
  }

  async mfaDisable(ip: string, admin: AuthedAdmin, password: string, code: string) {
    return this.locked(admin.id, async (a, repo, manager) => {
      if (!a.totpEnabled || !a.totpSecretEnc) throw new AppError(400, 'mfa_not_enabled', 'MFA is not enabled.');
      if (!(await verifyPassword(String(password || ''), a.passwordHash)) || !verifyTotp(decrypt(a.totpSecretEnc), String(code || '').trim())) {
        throw new AppError(401, 'bad_credentials', 'Password or code incorrect.');
      }
      a.totpEnabled = false;
      a.totpSecretEnc = null;
      await repo.save(a);
      await this.audit.record(`admin:${admin.username}`, 'mfa_disabled', {}, ip, manager);
      return { ok: true };
    });
  }

  listUsers() {
    return this.admins.createQueryBuilder('admin')
      .select([
        'admin.id AS id',
        'admin.username AS username',
        'admin.role AS role',
        'admin.totpEnabled AS totp_enabled',
        'admin.lastLoginAt AS last_login_at',
        'admin.createdAt AS created_at',
      ])
      .orderBy('admin.id', 'ASC')
      .getRawMany();
  }

  async createUser(ip: string, actor: AuthedAdmin, usernameRaw: string, password: string, roleRaw?: string) {
    const username = String(usernameRaw || '').trim().toLowerCase();
    const role = roleRaw === 'viewer' ? 'viewer' : 'admin';
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new AppError(400, 'bad_username', 'Username: 3–32 letters, digits, . _ -');
    if (String(password).length < 10) throw new AppError(400, 'weak_password', 'Password must be at least 10 characters.');
    try {
      const passwordHash = await hashPassword(password);
      const created = await this.admins.manager.transaction(async manager => {
        const repo = manager.getRepository(Admin);
        const created = await repo.save(repo.create({ username, passwordHash, role }));
        await this.audit.record(`admin:${actor.username}`, 'user_created', { username, role }, ip, manager);
        return created;
      });
      return { id: created.id };
    } catch (e: any) {
      if (e.code === '23505') throw new AppError(409, 'exists', 'That username is taken.');
      throw e;
    }
  }

  async deleteUser(ip: string, actor: AuthedAdmin, id: number) {
    if (id === actor.id) throw new AppError(400, 'self', 'You cannot delete your own account.');
    await this.admins.manager.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(20262027)');
      const repo = manager.getRepository(Admin);
      const current = await repo.findOneBy({ id: actor.id });
      if (!current || current.role !== 'admin') throw new AppError(401, 'unauthorized', 'Please sign in.');
      const target = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (target?.role === 'admin' && await repo.countBy({ role: 'admin' }) <= 1) {
        throw new AppError(400, 'last_admin', 'The last administrator cannot be deleted.');
      }
      await repo.delete({ id });
      await this.audit.record(`admin:${actor.username}`, 'user_deleted', { id }, ip, manager);
    });
    return { ok: true };
  }
}
