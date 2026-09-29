// Employee availability view helpers (Phase 2B-4). Pure and DOM-free so the
// formatting and grouping rules are unit-testable without rendering React.
//
// Kept in its own module (rather than in the .jsx) so `node --test` can import
// it directly, matching the lib/employee*.mjs convention.
//
// These helpers NEVER invent or infer availability. Every value they return is
// derived from a row the server already sent for the authenticated employee.
// An employee cannot edit another employee's availability through anything in
// this file, because this file has no concept of whose availability it is
// looking at: that scoping is the server's job.

export const AVAILABILITY_KIND = { AVAILABLE: "available", UNAVAILABLE: "unavailable" };

// Shown on the page exactly as the business specifies it. Availability is a
// planning hint, and the page must never imply it reserves work.
export const AVAILABILITY_DISCLAIMER =
  "Availability helps the admin plan schedules. It does not guarantee that you will be assigned work.";

export const AVAILABILITY_EMPTY_TITLE = "No availability added yet.";
export const AVAILABILITY_EMPTY_BODY =
  "Add the times you are generally able to work. The admin uses this when planning schedules.";

// "9:00 AM – 1:00 PM" from a 24-hour wall-clock pair. Converted here only for
// display; the stored value stays the unambiguous "HH:MM" the employee entered.
export function timeTo12Hour(hhmm) {
  if (typeof hhmm !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function availabilityWindowLabel(row) {
  const start = timeTo12Hour(row?.startTime);
  const end = timeTo12Hour(row?.endTime);
  if (!start || !end) return "Invalid time range";
  return `${start} – ${end}`;
}

export function isUnavailable(row) {
  return row?.kind === AVAILABILITY_KIND.UNAVAILABLE;
}

export function availabilityKindLabel(row) {
  return isUnavailable(row) ? "Unavailable" : "Available";
}

// Chronological, matching the server's own order. Sorting again in the browser
// is presentation only and cannot change WHICH rows are shown.
export function sortAvailability(rows) {
  return [...(rows ?? [])].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

// Groups consecutive rows by their "YYYY-MM-DD" day so the page can render one
// heading per day. The grouping key is the row's own date — never a date derived
// from the browser clock, which would misfile rows for anyone outside
// America/Chicago.
export function groupByDate(rows) {
  const groups = new Map();
  for (const row of sortAvailability(rows)) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row);
  }
  return [...groups.entries()].map(([date, items]) => ({ date, items }));
}

// "2026-09-27" -> "Sun, September 27, 2026" (or the raw string if unparseable).
export function availabilityDateLabel(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date ?? "";
  const d = new Date(`${date}T12:00:00.000Z`); // noon UTC: immune to a DST edge
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
