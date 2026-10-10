import 'reflect-metadata';
import { AdminAuthService } from '../src/admin/admin-auth.service';

describe('admin lock countdown', () => {
  afterEach(() => jest.useRealTimers());
  it.each([1, 1001, 300000])('returns rounded-up retryAfter for a lock lasting %s ms', async (duration) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-07T07:00:00Z'));
    const admins = { findOne: jest.fn().mockResolvedValue({ lockedUntil: new Date(Date.now() + duration) }) };
    const manager = { getRepository: () => admins };
    const service = new AdminAuthService({ ...admins, manager: { transaction: (work: any) => work(manager) } } as any, {} as any, {} as any);
    await expect(service.login({} as any, '127.0.0.1', 'admin', 'unused')).rejects.toMatchObject({
      response: { error: 'locked', retryAfter: Math.ceil(duration / 1000) },
    });
  });
});
