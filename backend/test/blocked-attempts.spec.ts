import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { AppError } from '../src/common/http-error';

it('records a rejected off-site request once and preserves its response', async () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ path: '/api/public/votes', ip: '192.0.2.1' }) }) };
  const filter = new AllExceptionsFilter(audit as any);
  await filter.catch(new AppError(403, 'not_on_site', 'Venue only', { access: { mode: 'geo', geoReason: 'outside' } }), host as any);
  expect(audit.record).toHaveBeenCalledTimes(1);
  expect(audit.record).toHaveBeenCalledWith('visitor', 'off_site_blocked', { route: '/api/public/votes', mode: 'geo', reason: 'outside' }, '192.0.2.1');
  expect(res.status).toHaveBeenCalledWith(403);
  await filter.catch(new AppError(403, 'voting_closed'), host as any);
  expect(audit.record).toHaveBeenCalledTimes(1);
});
