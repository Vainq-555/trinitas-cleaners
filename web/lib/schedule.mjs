// Deterministic America/Chicago appointment rendering for shared UI.
// The appointment is stored as a UTC instant; the explicit `timeZone` option
// makes the rendered date/time independent of the viewer's browser timezone.

export const BUSINESS_TIMEZONE = "America/Chicago";

const TZ_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIMEZONE,
  weekday: "short",
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

// iso: an ISO-8601 instant (Booking.scheduledStartAt). Returns
// { date, time, timezone } for valid input, otherwise null.
export function formatChicagoSchedule(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { date: TZ_DATE.format(d), time: TZ_TIME.format(d), timezone: BUSINESS_TIMEZONE };
}