// America/Chicago appointment scheduling utilities.
// The customer picks a WALL-CLOCK date + time. The single source of truth for
// that wall clock is America/Chicago: we convert the chosen wall time into the
// exact UTC instant it represents, and every UI renders that instant back to
// America/Chicago — never the viewer's own browser timezone. Manual conversion
// (no external deps); the UTC offset on a given date is resolved via Intl.

export const BUSINESS_TIMEZONE = "America/Chicago";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * UTC offset of `timeZone` at a given instant, as signed minutes
 * (e.g. 300 for CDT, 360 for CST). Resolved via Intl's "longOffset"
 * timezone name ("GMT-05:00"), available in Node 16.4+.
 */
function utcOffsetMinutesAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const name = parts.find((p) => p.type === "timeZoneName");
  const m = name && /^GMT([+-])(\d{2}):(\d{2})$/.exec(name.value);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** True for a real calendar date string "YYYY-MM-DD" (e.g. "2026-09-27"). */
export function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** True for 24h "HH:MM" (e.g. "10:00", "22:30"). */
export function isValidTimeString(value) {
  return typeof value === "string" && TIME_RE.test(value);
}

/**
 * Convert a customer-chosen America/Chicago wall-clock appointment
 * `scheduledStartDate` ("YYYY-MM-DD") + `scheduledStartTime` ("HH:MM") into
 * the UTC instant it represents.
 *
 * Returns `{ ok: true, scheduledStart: Date | null }` when both fields are
 * absent (a booking without a schedule stays valid), or
 * `{ ok: false, error }` for malformed/partial input.
 */
export function parseScheduledStart({ scheduledStartDate, scheduledStartTime } = {}) {
  const hasDate = typeof scheduledStartDate === "string" && scheduledStartDate.trim() !== "";
  const hasTime = typeof scheduledStartTime === "string" && scheduledStartTime.trim() !== "";
  // Empty/absent strings (e.g. a fresh form or an API caller that sends the
  // fields as "") mean "no schedule" — never a validation error.
  if (!hasDate && !hasTime) {
    return { ok: true, scheduledStart: null };
  }
  if (!hasDate || !hasTime) {
    return { ok: false, error: "scheduledStartDate and scheduledStartTime must be provided together" };
  }
  if (!isValidDateString(scheduledStartDate)) {
    return { ok: false, error: "scheduledStartDate must be a valid YYYY-MM-DD date" };
  }
  if (!isValidTimeString(scheduledStartTime)) {
    return { ok: false, error: "scheduledStartTime must be a valid HH:MM time (24-hour)" };
  }
  const probe = new Date(`${scheduledStartDate}T${scheduledStartTime}:00.000Z`);
  const offsetMinutes = utcOffsetMinutesAt(probe, BUSINESS_TIMEZONE);
  return { ok: true, scheduledStart: new Date(probe.getTime() - offsetMinutes * 60000) };
}

const TZ_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIMEZONE,
  month: "long",
  day: "numeric",
  year: "numeric",
});

const TZ_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Render a stored UTC instant — or a date-only legacy appointment — back to a
 * deterministic America/Chicago wall-clock string. Returns null when the
 * instant is invalid. The explicit timeZone option keeps the rendered value
 * independent of the process/browser timezone.
 */
export function formatChicagoStart(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { date: TZ_DATE.format(d), time: TZ_TIME.format(d), timezone: BUSINESS_TIMEZONE };
}