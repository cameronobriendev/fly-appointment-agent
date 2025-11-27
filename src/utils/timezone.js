/**
 * Robust timezone detection from user's reported local time
 * Ported from Cloudflare Worker implementation
 */

/**
 * Parse various time formats to minutes since midnight [0-1439]
 * Accepts: "2:30 pm", "2pm", "14:30", "1430", "02", "2"
 */
export function parseLocalTimeToMinutes(s) {
  if (!s) return null;
  const str = String(s).toLowerCase().replace(/[\s\.]/g, '');

  // 12h format like "230pm", "2:30pm", "2pm"
  const m12 = str.match(/^(\d{1,2})(:?(\d{2}))?(am|pm)$/);
  if (m12) {
    let h = Number(m12[1]);
    const min = Number(m12[3] || '0');
    const ap = m12[4];
    if (h === 12) h = 0;
    if (ap === 'pm') h += 12;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  // 24h format like "14:30" or "1430"
  const m24 = str.match(/^(\d{1,2})(:?)(\d{2})$/);
  if (m24) {
    const h = Number(m24[1]);
    const min = Number(m24[3]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  // Bare hour like "2" -> assume ":00"
  const mh = str.match(/^(\d{1,2})$/);
  if (mh) {
    const h = Number(mh[1]);
    if (h > 23) return null;
    return h * 60;
  }

  return null;
}

/**
 * Convert minutes since midnight to HH:MM format
 */
export function toHHMM(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Calculate timezone offset for a given IANA timezone at a specific date
 * Returns minutes (local - UTC), west negative
 * Uses Intl.DateTimeFormat with formatToParts for robust calculation
 */
export function offsetMinutesForZone(tz, date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = fmt.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const y = Number(map.year);
  const m = Number(map.month);
  const d = Number(map.day);
  const H = Number(map.hour);
  const M = Number(map.minute);
  const S = Number(map.second || '0');

  if (![y, m, d, H, M].every(Number.isFinite)) return NaN;

  const wallAsUTC = Date.UTC(y, m - 1, d, H, M, S);
  const utc = date.getTime();
  return Math.round((wallAsUTC - utc) / 60000);
}

/**
 * Find nearest timezone by absolute difference in offset
 */
export function nearestByAbsDiff(map, target) {
  let bestKey = null;
  let bestDiff = Infinity;
  for (const [k, v] of Object.entries(map)) {
    const d = Math.abs(v - target);
    if (d < bestDiff) {
      bestDiff = d;
      bestKey = k;
    }
  }
  return bestKey;
}

/**
 * Infer timezone from user's reported local time
 * Returns { tz, offsetMinutes, candidates } or { error }
 */
export function inferTimezone(reportedTime, nowUTC = new Date()) {
  // 1) Parse reported time -> minutes since midnight
  const repMin = parseLocalTimeToMinutes(reportedTime);
  if (repMin == null) {
    return { error: 'Unrecognized time format' };
  }

  // 2) Current UTC minutes-of-day
  const utcMin = nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes();

  // 3) Infer (local - UTC) minutes, normalized to [-720, 720]; snap to hour
  let offset = repMin - utcMin;
  while (offset <= -720) offset += 1440;
  while (offset > 720) offset -= 1440;
  offset = Math.round(offset / 60) * 60;

  // 4) Candidate zones (continental US/CA, incl. no-DST variants + Atlantic)
  const ZONES = [
    'America/New_York',
    'America/Toronto',
    'America/Chicago',
    'America/Winnipeg',
    'America/Regina',
    'America/Denver',
    'America/Edmonton',
    'America/Los_Angeles',
    'America/Vancouver',
    'America/Phoenix',
    'America/Halifax',
  ];

  // 5) Compute live offsets (local - UTC) for each zone at 'now'
  const zoneOffsets = {};
  for (const tz of ZONES) {
    const off = offsetMinutesForZone(tz, nowUTC);
    if (Number.isFinite(off)) zoneOffsets[tz] = off;
  }

  // 6) Exact matches first; otherwise nearest by absolute difference
  let candidates = Object.entries(zoneOffsets)
    .filter(([, off]) => off === offset)
    .map(([tz]) => tz);

  if (candidates.length === 0) {
    const nearest = nearestByAbsDiff(zoneOffsets, offset);
    if (nearest) candidates = [nearest];
  }

  // 7) Deterministic pick; ALWAYS return a string tz
  const PRIORITY = [
    'America/Halifax',
    'America/New_York',
    'America/Toronto',
    'America/Chicago',
    'America/Winnipeg',
    'America/Regina',
    'America/Denver',
    'America/Edmonton',
    'America/Los_Angeles',
    'America/Vancouver',
    'America/Phoenix',
  ];

  const tz =
    candidates.find((z) => PRIORITY.includes(z)) ||
    candidates[0] ||
    'Etc/UTC';

  return {
    tz, // IANA timezone string (e.g., "America/Denver")
    offsetMinutes: offset, // local - UTC (west negative)
    candidates, // all matching timezones
    reportedLocal24h: toHHMM(repMin),
  };
}
