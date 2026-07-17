/**
 * Timezone-aware time helpers.
 *
 * Replaces the hardcoded `TZ_OFFSET_MS = 3 * 60 * 60 * 1000` constants that were
 * duplicated across the jobs. Those assumed both a fixed UTC+3 offset and a UTC
 * server clock; neither is guaranteed on Coolify.
 *
 * Built on Intl.DateTimeFormat so DST is handled correctly for any zone (a no-op
 * for Africa/Nairobi, which has no DST, but these helpers are shared).
 */

export const DEFAULT_TIMEZONE = 'Africa/Nairobi';

/**
 * Extract calendar/clock parts of `atMs` as observed in `tz`.
 */
const partsIn = (tz, atMs) => {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const out = {};
  for (const { type, value } of fmt.formatToParts(atMs)) {
    if (type !== 'literal') out[type] = value;
  }

  return {
    year: parseInt(out.year, 10),
    month: parseInt(out.month, 10),
    day: parseInt(out.day, 10),
    // Intl emits hour 24 for midnight under hour12:false in some engines.
    hour: parseInt(out.hour, 10) % 24,
    minute: parseInt(out.minute, 10),
    second: parseInt(out.second, 10),
  };
};

/**
 * Offset of `tz` from UTC at `atMs`, in ms (positive east of Greenwich).
 */
const offsetMs = (tz, atMs) => {
  const p = partsIn(tz, atMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Wall-clock reading minus the true instant is the zone's offset. Round to the
  // second to absorb the sub-second truncation in formatToParts.
  return asUtc - Math.floor(atMs / 1000) * 1000;
};

/**
 * Epoch ms of local midnight in `tz` for the day containing `atMs`.
 */
export const startOfLocalDayMs = (tz = DEFAULT_TIMEZONE, atMs = Date.now()) => {
  const p = partsIn(tz, atMs);
  const guess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  // `guess` is midnight-as-if-UTC; subtract the offset to land on the real instant.
  // Recompute the offset at that instant so DST transitions resolve correctly.
  const off = offsetMs(tz, guess - offsetMs(tz, atMs));
  return guess - off;
};

/**
 * Epoch ms of the next local midnight — the exclusive end of the local day.
 */
export const endOfLocalDayMs = (tz = DEFAULT_TIMEZONE, atMs = Date.now()) => {
  const start = startOfLocalDayMs(tz, atMs);
  // +26h then re-truncate: lands inside the next day even across a DST shift.
  return startOfLocalDayMs(tz, start + 26 * 60 * 60 * 1000);
};

/**
 * Local calendar day as 'YYYY-MM-DD'. Used as the idempotency key for daily jobs.
 */
export const localDateString = (tz = DEFAULT_TIMEZONE, atMs = Date.now()) => {
  const p = partsIn(tz, atMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/**
 * Local wall clock as { hour, minute }.
 */
export const localHourMinute = (tz = DEFAULT_TIMEZONE, atMs = Date.now()) => {
  const p = partsIn(tz, atMs);
  return { hour: p.hour, minute: p.minute };
};

/**
 * Minutes since local midnight — convenient for comparing against a HH:MM setting.
 */
export const localMinutesOfDay = (tz = DEFAULT_TIMEZONE, atMs = Date.now()) => {
  const { hour, minute } = localHourMinute(tz, atMs);
  return hour * 60 + minute;
};

/**
 * Parse a 'HH:MM' / 'HH:MM:SS' string (e.g. a Postgres TIME) to minutes since midnight.
 * Returns null when unparseable, so callers can fall back rather than fire at 00:00.
 */
export const parseTimeToMinutes = (value) => {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
};

/**
 * True when `tz` is a zone this runtime actually understands. Guards user input
 * before it reaches a cron sweep, where a throw would kill the whole tick.
 */
export const isValidTimezone = (tz) => {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
