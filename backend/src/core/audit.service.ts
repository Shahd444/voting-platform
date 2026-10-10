import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/** Append-only trail of admin actions and security-relevant events. */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(private readonly ds: DataSource) {}

  async record(actor: string, action: string, detail: Record<string, unknown> = {}, ip: string | null = null, manager?: EntityManager) {
    if (manager) {
      await manager.query('INSERT INTO audit_log(actor, action, detail, ip) VALUES ($1,$2,$3,$4)', [actor, action, detail, ip]);
      return;
    }
    try {
      await this.ds.query('INSERT INTO audit_log(actor, action, detail, ip) VALUES ($1,$2,$3,$4)', [actor, action, detail, ip]);
    } catch (e) {
      this.log.warn(`audit write failed: ${(e as Error).message}`);
    }
  }
}
