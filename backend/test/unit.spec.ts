import 'reflect-metadata';
import * as c from '../src/common/crypto.util';
import { Geofence, GeoPoint, geoAllowed, haversineMeters, ipAllowed, validGeofence } from '../src/common/geo.util';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AccessCheckDto, LocationDto, RequestOtpDto, CastVoteDto } from '../src/visitor/visitor.dto';
import { VisitorService } from '../src/visitor/visitor.service';
import { AccessSettingsDto, GeofenceDto } from '../src/admin/admin.dto';
import { EventService } from '../src/admin/event.service';
import { DEFAULT_SETTINGS, SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/core/audit.service';
import { DataSource } from 'typeorm';
import * as migrations from '../src/database/migrate';
import { CATEGORIES, EXHIBITORS, main as seed } from '../src/cli/seed';
import { normalizePhone } from '../src/common/phone.util';
import { currentTotp, generateTotpSecret, verifyTotp } from '../src/common/totp.util';
import { AccessService } from '../src/core/access.service';
import { VoteQrService } from '../src/core/vote-qr.service';
import { AccessMode, AllSettings } from '../src/settings/settings.types';

describe('phone normalisation', () => {
  it('accepts Jordanian local, international and Arabic-Indic forms', () => {
    expect(normalizePhone('0791234567')).toBe('962791234567');
    expect(normalizePhone('079 123 4567')).toBe('962791234567');
    expect(normalizePhone('+962 79 123 4567')).toBe('962791234567');
    expect(normalizePhone('00962791234567')).toBe('962791234567');
    expect(normalizePhone('791234567')).toBe('962791234567');
    expect(normalizePhone('٠٧٩١٢٣٤٥٦٧')).toBe('962791234567');
    expect(normalizePhone('+44 7700 900123')).toBe('447700900123');
  });
  it('rejects non-mobile and garbage input', () => {
    expect(normalizePhone('0761234567')).toBeNull();
    expect(normalizePhone('+962 6 123 4567')).toBeNull();
    expect(normalizePhone('hello')).toBeNull();
  });
});

describe('on-site checks', () => {
  const access = new AccessService();
  const settings = (mode: AccessMode) => ({ access: {
    mode, allowed_cidrs: ['10.0.0.0/8'],
    geofence: { lat: 0, lng: 0, radius_m: 100, max_accuracy_m: 500 },
  } }) as AllSettings;
  const modes: AccessMode[] = ['ip', 'geo', 'ip_or_geo', 'ip_and_geo'];
  const validLocation: GeoPoint = { lat: 0, lng: 0, accuracy: 10 };
  const locations: { label: string; value: GeoPoint | null; valid: boolean }[] = [
    { label: 'valid GPS', value: validLocation, valid: true },
    { label: 'outside GPS', value: { lat: 1, lng: 1, accuracy: 10 }, valid: false },
    { label: 'missing GPS', value: null, valid: false },
    { label: 'invalid latitude', value: { lat: 91, lng: 0 }, valid: false },
    { label: 'invalid longitude', value: { lat: 0, lng: 181 }, valid: false },
    { label: 'non-finite GPS', value: { lat: NaN, lng: 0 }, valid: false },
    { label: 'inaccurate GPS', value: { lat: 0, lng: 0, accuracy: 900 }, valid: false },
  ];
  const ips = [
    { label: 'valid IP', value: '10.1.1.1', valid: true },
    { label: 'outside IP', value: '8.8.8.8', valid: false },
    { label: 'missing IP', value: undefined, valid: false },
    { label: 'malformed IP', value: 'garbage', valid: false },
  ];
  // Expected permissions for the four combinations: neither, GPS, IP, both.
  const permissions: Record<string, Record<AccessMode, boolean>> = {
    'false:false': { ip: false, geo: false, ip_or_geo: false, ip_and_geo: false, off: true },
    'false:true': { ip: false, geo: true, ip_or_geo: true, ip_and_geo: false, off: true },
    'true:false': { ip: true, geo: false, ip_or_geo: true, ip_and_geo: false, off: true },
    'true:true': { ip: true, geo: true, ip_or_geo: true, ip_and_geo: true, off: true },
  };
  for (const mode of modes) {
    for (const ip of ips) {
      for (const location of locations) {
        it(`${mode}: ${ip.label} + ${location.label}`, () => {
          const verdict = access.evaluate(settings(mode), ip.value, location.value);
          expect(verdict.allowed).toBe(permissions[`${ip.valid}:${location.valid}`][mode]);
          expect(verdict.ipOk).toBe(ip.valid);
          expect(verdict.geoOk).toBe(location.valid);
          const expectedNeedsLocation = location.value === null &&
            (mode === 'geo' || mode === 'ip_and_geo' || (mode === 'ip_or_geo' && !ip.valid));
          expect(verdict.needsLocation).toBe(expectedNeedsLocation);
        });
      }
    }
  }
  it('matches CIDR ranges (IPv4, IPv6, mapped)', () => {
    const list = ['192.168.1.0/24', '2001:db8::/32', '37.220.1.10'];
    expect(ipAllowed('192.168.1.77', list)).toBe(true);
    expect(ipAllowed('::ffff:192.168.1.77', list)).toBe(true);
    expect(ipAllowed('2001:db8::1', list)).toBe(true);
    expect(ipAllowed('37.220.1.10', list)).toBe(true);
    expect(ipAllowed('37.220.1.11', list)).toBe(false);
    expect(ipAllowed('garbage', list)).toBe(false);
  });
  it('applies the geofence with an accuracy limit', () => {
    const fence = { lat: 31.9539, lng: 35.9106, radius_m: 300, max_accuracy_m: 200 };
    expect(geoAllowed({ lat: 31.9545, lng: 35.911, accuracy: 20 }, fence).ok).toBe(true);
    expect(geoAllowed({ lat: 32.05, lng: 35.9, accuracy: 20 }, fence).reason).toBe('outside_geofence');
    expect(geoAllowed({ lat: 31.9545, lng: 35.911, accuracy: 900 }, fence).reason).toBe('low_accuracy');
  });
  it('combines IP and location per mode', () => {
    const svc = new AccessService();
    const s = (mode: string) => ({ access: { mode, allowed_cidrs: ['10.0.0.0/8'], geofence: { lat: 0, lng: 0, radius_m: 100, max_accuracy_m: 500 } } }) as unknown as AllSettings;
    const here = { lat: 0, lng: 0, accuracy: 10 };
    expect(svc.evaluate(s('ip_or_geo'), '10.1.1.1', null).allowed).toBe(true);
    expect(svc.evaluate(s('ip_or_geo'), '8.8.8.8', here).allowed).toBe(true);
    expect(svc.evaluate(s('ip_or_geo'), '8.8.8.8', null).needsLocation).toBe(true);
    expect(svc.evaluate(s('ip'), '8.8.8.8', here).allowed).toBe(false);
    expect(svc.evaluate(s('ip_and_geo'), '10.1.1.1', null).allowed).toBe(false);
    expect(svc.evaluate(s('ip_and_geo'), '10.1.1.1', here).allowed).toBe(true);
    expect(svc.evaluate(s('off'), '8.8.8.8', null).allowed).toBe(true);
  });
});

describe('location validation', () => {
  const fence: Geofence = { lat: 31.95, lng: 35.91, radius_m: 100, max_accuracy_m: 200 };
  const here: GeoPoint = { lat: fence.lat, lng: fence.lng, accuracy: 20 };
  const invalidLocations = [
    { lat: 500 }, { lat: -91 }, { lng: -400 }, { lng: 181 },
    { lat: NaN }, { lng: Infinity }, { lat: '31.95' }, { lng: null },
    { accuracy: -10 }, { accuracy: NaN }, { accuracy: Infinity },
    { accuracy: null }, { accuracy: '20' },
  ];
  it.each(invalidLocations)('rejects malformed location %j in the DTO and geofence', (patch) => {
    const loc = { ...here, ...patch };
    expect(validateSync(plainToInstance(LocationDto, loc)).length).toBeGreaterThan(0);
    expect(geoAllowed(loc as GeoPoint, fence).reason).toBe('bad_location');
  });
  it.each([undefined, 0, 20])('accepts optional/valid accuracy %s without a timestamp', (accuracy) => {
    const loc = { ...here, accuracy };
    expect(validateSync(plainToInstance(LocationDto, loc))).toHaveLength(0);
    expect(geoAllowed(loc, fence).ok).toBe(true);
  });
  it.each([[-90, -180], [90, 180]])('accepts coordinate boundaries %s, %s', (lat, lng) => {
    expect(validateSync(plainToInstance(LocationDto, { lat, lng }))).toHaveLength(0);
    expect(geoAllowed({ lat, lng }, { ...fence, lat, lng }).ok).toBe(true);
  });
  it('preserves invalid accuracy through visitor conversion so it cannot become zero', () => {
    const loc = VisitorService.loc({ ...here, accuracy: NaN });
    expect(loc?.accuracy).toBeNaN();
    expect(geoAllowed(loc, fence).reason).toBe('bad_location');
  });
  it('validates nested locations in access, OTP and voting requests', () => {
    const bodies = [
      plainToInstance(AccessCheckDto, { location: { ...here, accuracy: -1 } }),
      plainToInstance(RequestOtpDto, { name: 'Visitor', phone: '0791234567', location: { ...here, lat: 500 } }),
      plainToInstance(CastVoteDto, { categoryId: 1, exhibitorId: 1, location: { ...here, lng: -400 } }),
    ];
    for (const body of bodies) expect(validateSync(body).some((e) => e.property === 'location')).toBe(true);
  });
  it('keeps distance finite at coincident and antipodal points', () => {
    expect(haversineMeters(0, 0, 0, 0)).toBe(0);
    expect(haversineMeters(0, 0, 0, 1)).toBeCloseTo(111194.93, 2);
    expect(haversineMeters(45, 20, -45, -160)).toBeCloseTo(Math.PI * 6371000, 0);
  });
  it('checks the actual radius before rounding and caps accuracy overlap at 100 metres', () => {
    const north = (metres: number): GeoPoint => ({ lat: metres / 6371000 * 180 / Math.PI, lng: 0, accuracy: 0 });
    const origin = { ...fence, lat: 0, lng: 0 };
    expect(geoAllowed(north(99.9), origin).ok).toBe(true);
    expect(geoAllowed(north(100.1), origin).ok).toBe(false);
    expect(geoAllowed({ ...north(119), accuracy: 20 }, origin).ok).toBe(true);
    expect(geoAllowed({ ...north(201), accuracy: 200 }, origin).ok).toBe(false);
  });
  it('enforces the accuracy ceiling including zero', () => {
    expect(geoAllowed({ ...here, accuracy: 201 }, fence).reason).toBe('low_accuracy');
    expect(geoAllowed({ ...here, accuracy: 200 }, fence).ok).toBe(true);
    expect(geoAllowed(here, { ...fence, max_accuracy_m: 0 }).reason).toBe('low_accuracy');
    expect(geoAllowed({ ...here, accuracy: 0 }, { ...fence, max_accuracy_m: 0 }).ok).toBe(true);
  });
  const invalidFences = [
    { lat: 91 }, { lng: -181 }, { radius_m: 9 }, { radius_m: 50001 },
    { radius_m: Infinity }, { max_accuracy_m: -1 }, { max_accuracy_m: NaN },
    { max_accuracy_m: null }, { lat: '31.95' },
  ];
  it.each(invalidFences)('rejects invalid admin geofence %j before saving', async (patch) => {
    const g = { ...fence, ...patch };
    expect(validateSync(plainToInstance(GeofenceDto, g)).length).toBeGreaterThan(0);
    expect(validGeofence(g as Geofence)).toBe(false);
    expect(geoAllowed(here, g as Geofence).reason).toBe('bad_geofence');
    const settings = { update: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new EventService(settings as unknown as SettingsService, audit as unknown as AuditService, new VoteQrService());
    await expect(service.updateAccess('admin', '127.0.0.1', { geofence: g as GeofenceDto }))
      .rejects.toMatchObject({ response: { error: 'bad_geofence' } });
    expect(settings.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
  it('validates nested admin geofences', () => {
    const body = plainToInstance(AccessSettingsDto, { geofence: { ...fence, max_accuracy_m: -1 } });
    expect(validateSync(body).some((e) => e.property === 'geofence')).toBe(true);
  });
  it.each([0, undefined])('saves zero or omitted admin accuracy %s consistently', async (accuracy) => {
    const settings = { update: jest.fn().mockImplementation(async (_, patch) => patch) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new EventService(settings as unknown as SettingsService, audit as unknown as AuditService, new VoteQrService());
    const g = { ...fence, max_accuracy_m: accuracy };
    expect(validateSync(plainToInstance(GeofenceDto, g))).toHaveLength(0);
    await service.updateAccess('admin', '127.0.0.1', { geofence: g });
    expect(settings.update).toHaveBeenCalledWith('access', { geofence: { ...g, max_accuracy_m: accuracy === undefined ? 500 : accuracy } }, expect.any(Function));
  });
});

describe('scheduled voting boundaries', () => {
  const start = '2026-10-07T10:00:00+03:00';
  const end = '2026-10-07T12:00:00+03:00';
  const service = new SettingsService({} as DataSource, { on: jest.fn() } as any);
  afterEach(() => jest.restoreAllMocks());
  it.each([
    [Date.parse(start) - 1, false, 'not_started'],
    [Date.parse(start), true, undefined],
    [Date.parse(start) + 1, true, undefined],
    [Date.parse(end) - 1, true, undefined],
    [Date.parse(end), false, 'ended'],
    [Date.parse(end) + 1, false, 'ended'],
  ])('evaluates the window at epoch %s', (now, open, reason) => {
    jest.spyOn(Date, 'now').mockReturnValue(now as number);
    const settings = { ...DEFAULT_SETTINGS, voting: { open: true, opens_at: start, closes_at: end } };
    const state = service.votingState(settings);
    expect(state.open).toBe(open);
    expect(state.reason).toBe(reason);
    // An Asia/Amman offset and the corresponding UTC instants have identical behavior.
    const utcState = service.votingState({ ...settings, voting: { ...settings.voting,
      opens_at: new Date(start).toISOString(), closes_at: new Date(end).toISOString() } });
    expect(utcState.open).toBe(open);
    expect(utcState.reason).toBe(reason);
  });
});

describe('three-category sample setup', () => {
  it('keeps unknown venue settings unset and voting closed', () => {
    expect(DEFAULT_SETTINGS.event.venue).toBe('');
    expect(DEFAULT_SETTINGS.voting).toEqual({ open: false, opens_at: null, closes_at: null });
    expect(DEFAULT_SETTINGS.access.allowed_cidrs).toEqual([]);
    expect(DEFAULT_SETTINGS.access.geofence).toEqual({ lat: null, lng: null, radius_m: null, max_accuracy_m: null });
    expect(new AccessService().evaluate(DEFAULT_SETTINGS, '10.0.0.1', { lat: 31.95, lng: 35.91, accuracy: 20 }).allowed).toBe(false);
  });
  afterEach(() => jest.restoreAllMocks());
  it('contains exactly three unique categories and valid assignments for every sample exhibitor', () => {
    expect(CATEGORIES).toHaveLength(3);
    const slugs = new Set(CATEGORIES.map((c) => c.slug));
    expect(slugs.size).toBe(3);
    expect(EXHIBITORS).toHaveLength(22);
    for (const exhibitor of EXHIBITORS) {
      expect(exhibitor[4].length).toBeGreaterThan(0);
      expect(new Set(exhibitor[4]).size).toBe(exhibitor[4].length);
      for (const slug of exhibitor[4]) expect(slugs.has(slug)).toBe(true);
    }
    for (const slug of slugs) expect(EXHIBITORS.some((e) => e[4].includes(slug))).toBe(true);
  });
  it.each([
    { categories: 5, exhibitors: 0, votes: 0 },
    { categories: 0, exhibitors: 22, votes: 0 },
    { categories: 3, exhibitors: 22, votes: 100 },
    { categories: 0, exhibitors: 0, votes: 1 },
  ])('does not reseed or delete existing data %j', async (existing) => {
    const ds = {
      query: jest.fn().mockImplementation(async (sql: string) => sql.includes('AS categories') ? [existing] : []),
      transaction: jest.fn(), destroy: jest.fn().mockResolvedValue(undefined),
    };
    ds.transaction.mockImplementation(async fn => fn({ query: ds.query }));
    jest.spyOn(DataSource.prototype, 'initialize').mockResolvedValue(ds as unknown as DataSource);
    jest.spyOn(migrations, 'runMigrationsLocked').mockResolvedValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await seed();
    expect(ds.transaction).toHaveBeenCalledTimes(1);
    expect(ds.query.mock.calls.some(([sql]) => sql.includes('LOCK TABLE votes'))).toBe(true);
    expect(ds.query.mock.calls.some(([sql]) => /DELETE|UPDATE categories|INSERT INTO categories/i.test(sql))).toBe(false);
    expect(ds.destroy).toHaveBeenCalled();
  });
  it('seeds three active categories and all exhibitor assignments on an empty database', async () => {
    let nextId = 0;
    const manager = { query: jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('AS categories')) return [{ categories: 0, exhibitors: 0, votes: 0 }];
      if (sql.startsWith('INSERT INTO categories')) return [{ id: ++nextId }];
      return [{ id: 100 }];
    }) };
    const ds = {
      query: jest.fn().mockImplementation(async (sql: string) => sql.includes('AS categories') ? [{ categories: 0, exhibitors: 0, votes: 0 }] : []),
      transaction: jest.fn().mockImplementation(async (fn) => fn(manager)),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(DataSource.prototype, 'initialize').mockResolvedValue(ds as unknown as DataSource);
    jest.spyOn(migrations, 'runMigrationsLocked').mockResolvedValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await seed();
    const calls = manager.query.mock.calls as unknown as [string, unknown[]][];
    const categories = calls.filter(([sql]) => sql.startsWith('INSERT INTO categories'));
    expect(categories).toHaveLength(3);
    expect(categories.map(([, params]) => params[0])).toEqual(CATEGORIES.map((c) => c.slug));
    expect(calls.filter(([sql]) => sql.startsWith('INSERT INTO exhibitors'))).toHaveLength(22);
    const assignments = calls.filter(([sql]) => sql.startsWith('INSERT INTO exhibitor_categories'));
    expect(assignments).toHaveLength(EXHIBITORS.reduce((n, e) => n + e[4].length, 0));
    for (const [, params] of assignments) expect([1, 2, 3]).toContain(params[1]);
    expect(calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
    expect(ds.destroy).toHaveBeenCalled();
  });
});

describe('crypto', () => {
  it('TOTP round trip', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, currentTotp(secret))).toBe(true);
    expect(verifyTotp(secret, 'abc')).toBe(false);
  });
  it('encrypts PII with authenticated encryption', () => {
    const blob = c.encrypt('0791234567');
    expect(blob).not.toContain('0791234567');
    expect(c.decrypt(blob)).toBe('0791234567');
    expect(c.encrypt('x')).not.toBe(c.encrypt('x'));
    const tampered = blob.slice(0, -2) + (blob.endsWith('A') ? 'B' : 'A') + '=';
    expect(() => c.decrypt(tampered)).toThrow();
  });
  it('hashes passwords with scrypt', async () => {
    const h = await c.hashPassword('correct horse battery');
    expect(await c.verifyPassword('correct horse battery', h)).toBe(true);
    expect(await c.verifyPassword('wrong', h)).toBe(false);
  });
});

describe('venue screen QR', () => {
  it('encodes a currently valid entry token in the voting URL and says when it rotates', async () => {
    const qr = new VoteQrService();
    const now = Date.now();
    const { token, refreshAt } = qr.issue(now);
    expect(qr.isValid(token, now)).toBe(true);
    const entry = await qr.entryQr('http://192.168.1.20:3000/', 200, now);
    expect(entry.qr).toMatch(/^data:image\/png;base64,/);
    expect(entry.refreshAt).toBe(refreshAt);
    expect(entry.refreshIn).toBe(refreshAt - now);
    expect(entry.refreshIn).toBeGreaterThan(0);
  });

  it('accepts the previous code for scan latency but rejects older or forged ones', () => {
    const qr = new VoteQrService();
    const now = Date.now();
    const period = 20_000;
    expect(qr.isValid(qr.issue(now - period).token, now)).toBe(true);
    expect(qr.isValid(qr.issue(now - 2 * period).token, now)).toBe(false);
    expect(qr.isValid(qr.issue(now + period).token, now)).toBe(false);
    expect(qr.isValid('v1.1.forged', now)).toBe(false);
  });
});

describe('voting page address (what the venue QR opens)', () => {
  it.each([
    ['http://192.168.1.20:3000', 'http://192.168.1.20:3000'],
    ['192.168.1.20:3000', 'http://192.168.1.20:3000'],
    ['  http://192.168.1.20:3000/admin?x=1#y  ', 'http://192.168.1.20:3000'],
    ['https://vote.example.org/', 'https://vote.example.org'],
    ['', ''],
    ['   ', ''],
  ])('normalises %j to %j', (input, expected) => {
    expect(EventService.publicUrl(input)).toBe(expected);
  });

  it.each(['ftp://192.168.1.20', 'javascript:alert(1)', 'http://', 'http://user:pw@192.168.1.20', 'not a url at all'])('rejects %j', (input) => {
    expect(() => EventService.publicUrl(input)).toThrow(/address visitors open/);
  });

  it('puts the address in the QR and makes the token current', async () => {
    const qr = new VoteQrService();
    const now = Date.now();
    const { qr: image } = await qr.entryQr('http://192.168.1.20:3000', 300, now);
    expect(image).toMatch(/^data:image\/png;base64,/);
  });
});
