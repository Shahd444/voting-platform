export const SCHEDULE_TIMEZONE = 'Asia/Amman';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Stored instants always render in the event timezone. */
export function scheduleInput(value: string | null | undefined): string {
  if (!value) return '';
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Interpret wall-clock input in Amman, independently of the browser timezone. */
export function scheduleTimestamp(value: string): string | null {
  if (!value) return null;
  const invalid = () => Object.assign(new Error('Please enter a valid schedule date and time.'), { code: 'bad_date' });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw invalid();
  const wall = new Date(`${value}:00.000Z`);
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 16) !== value) throw invalid();
  let instant = wall.getTime();
  for (let i = 0; i < 3; i++) {
    const rendered = Date.parse(`${scheduleInput(new Date(instant).toISOString())}:00Z`);
    instant += wall.getTime() - rendered;
  }
  const timestamp = new Date(instant).toISOString();
  if (scheduleInput(timestamp) !== value) throw invalid();
  return timestamp;
}

export function scheduleWindow(opensAt: string, closesAt: string) {
  const opens_at = scheduleTimestamp(opensAt), closes_at = scheduleTimestamp(closesAt);
  if (opens_at && closes_at && Date.parse(closes_at) <= Date.parse(opens_at)) {
    throw Object.assign(new Error('Voting end must be after voting start.'), { code: 'bad_voting_window' });
  }
  return { opens_at, closes_at };
}
