import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/schedule.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { scheduleTimestamp, scheduleInput, scheduleWindow } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('schedule values preserve the selected instant across browser and server timezones', () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const [timezone, local, expected] of [
      ['Asia/Amman', '2026-10-07T10:00', '2026-10-07T07:00:00.000Z'],
      ['UTC', '2026-10-07T10:00', '2026-10-07T07:00:00.000Z'],
      ['America/New_York', '2026-01-07T10:00', '2026-01-07T07:00:00.000Z'],
      ['America/New_York', '2026-07-07T10:00', '2026-07-07T07:00:00.000Z'],
      ['Asia/Kolkata', '2026-10-07T10:00', '2026-10-07T07:00:00.000Z'],
    ]) {
      process.env.TZ = timezone;
      const timestamp = scheduleTimestamp(local);
      assert.equal(timestamp, expected, timezone);
      assert.equal(scheduleInput(timestamp), local, timezone);
      process.env.TZ = 'UTC';
      assert.equal(new Date(timestamp).toISOString(), expected, 'UTC server preserves browser selection');
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('empty boundaries clear the schedule and invalid dates are rejected', () => {
  assert.equal(scheduleTimestamp(''), null);
  assert.throws(() => scheduleTimestamp('invalid'), /valid schedule date and time/);
  for (const value of ['2026-02-30T10:00', '2026-13-01T10:00', '2026-10-07T24:00']) {
    assert.throws(() => scheduleTimestamp(value), /valid schedule date and time/);
  }
  assert.equal(scheduleInput(null), '');
});

test('windows require the end to follow the start and allow clearing either boundary', () => {
  for (const end of ['2026-10-07T10:00', '2026-10-07T09:00']) {
    assert.throws(() => scheduleWindow('2026-10-07T10:00', end), /end must be after/);
  }
  assert.deepEqual(scheduleWindow('', ''), { opens_at: null, closes_at: null });
  assert.equal(scheduleWindow('2026-10-07T10:00', '').opens_at, '2026-10-07T07:00:00.000Z');
});
