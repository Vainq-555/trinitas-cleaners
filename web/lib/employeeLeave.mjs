// Employee leave-request view helpers. Pure and DOM-free so the date-range and
// status rules are unit-testable without rendering React.
//
// Kept in its own module (rather than in the .jsx) so `node --test` can import it
// directly, matching the lib/employee*.mjs convention.
//
// LEAVE IS NOT AVAILABILITY. Availability is the employee's own stated preference
// ("when I can work") and is informational. Leave is a formal REQUEST FOR TIME OFF
// that only an admin can approve or decline. This module renders both ideas without
// ever merging them: a request is never presented as "unavailable", and no helper
// here writes availability data.
//
// NOTHING HERE DECIDES AUTHORIZATION. Whether a request is the employee's own, and
// whether it may be decided at all, are decided server-side and arrive as fields.
// These helpers only PRESENT them, so there is no browser-side rule that could be
// trusted with access control — and no way for a client edit to reveal a request
// the server did not send.

export const LEAVE_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  DECLINED: "declined",
};

// The optional leave kinds, mirroring LEAVE_KIND in api/src/config.js. The list is
// duplicated deliberately rather than fetched: it is presentational, the server is
// the authority on what it accepts, and an unknown kind still renders as plain text
// rather than breaking the page.
export const LEAVE_KINDS = ["vacation", "sick", "personal", "other"];

export const LEAVE_EMPTY_TITLE = "No leave requests yet.";
export const LEAVE_EMPTY_BODY =
  "When you need time off, request it here and the admin will approve or decline it. Your request and its outcome stay listed below.";

// Said in plain words on the request form, because the most expensive confusion in
// this feature is an employee assuming a request is already approved — or assuming
// requesting leave silently blocks them from scheduled work.
export const LEAVE_REQUEST_DISCLAIMER =
  "A leave request is a request. The admin approves or declines it, and an approved request does not change any booking or assignment already scheduled for you.";

// A request is "pending" only while it is genuinely undecided. An unknown status
// (for example one added by a future release) is reported as PENDING rather than
// silently treated as approved or declined, so a new state can never be
// mis-reported to an employee as a decision.
export function leaveStatusLabel(status) {
  switch (status) {
    case LEAVE_STATUS.APPROVED:
      return "Approved";
    case LEAVE_STATUS.DECLINED:
      return "Declined";
    case LEAVE_STATUS.REQUESTED:
      return "Awaiting decision";
    default:
      return "Awaiting decision";
  }
}

// Tailwind classes per status. Kept here so a new status cannot be added without
// also deciding how it looks.
export function leaveStatusClass(status) {
  switch (status) {
    case LEAVE_STATUS.APPROVED:
      return "bg-okbg text-clean-dark";
    case LEAVE_STATUS.DECLINED:
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-warnbg text-amber-700";
  }
}

export function isPendingLeave(request) {
  return request?.status === LEAVE_STATUS.REQUESTED;
}

// Only a pending request may be decided, and the server enforces that too. The
// button is hidden on the client so a decided request is not offered a control that
// is guaranteed to be refused.
export function canDecideLeave(request) {
  return isPendingLeave(request);
}

// "YYYY-MM-DD" -> "Mon 3 Nov 2026". Parsed as a UTC instant from the day alone and
// formatted in UTC, so a leave day can never be displayed one day earlier/later
// than the employee typed because of the viewer's timezone.
const DAY_MS = 24 * 3600 * 1000;

const pad = (n) => String(n).padStart(2, "0");

function parseDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const at = Date.UTC(y, m - 1, d);
  const back = new Date(at);
  // Rejects an impossible calendar day (e.g. 2026-02-30) that the format alone allows.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return at;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function leaveDayLabel(value) {
  const at = parseDay(value);
  if (at === null) return value || "";
  const d = new Date(at);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// A one-day request reads as a single date; a span reads as "from X to Y".
export function leaveRangeLabel(request) {
  if (!request) return "";
  const { startsOn, endsOn } = request;
  if (!startsOn) return "";
  if (!endsOn || startsOn === endsOn) return leaveDayLabel(startsOn);
  return `${leaveDayLabel(startsOn)} – ${leaveDayLabel(endsOn)}`;
}

// The kind bucket, in a sentence. An absent kind is still a complete request, so it
// renders as plain "Time off" rather than a blank or a "null".
export function leaveKindLabel(request) {
  const kind = request?.kind;
  if (!kind) return "Time off";
  return String(kind).charAt(0).toUpperCase() + String(kind).slice(1);
}

// The outcome line: who decided and when, or that nobody has yet. Uses only fields
// the server sent — an employee can never see a decision that was not made.
export function leaveDecisionLabel(request) {
  if (isPendingLeave(request)) return "Awaiting the admin's decision";
  const who = request?.decidedByName ? ` by ${request.decidedByName}` : "";
  const when = request?.decidedAt ? ` on ${leaveDayLabel(String(request.decidedAt).slice(0, 10))}` : "";
  return `${leaveStatusLabel(request?.status)}${who}${when}`;
}

// The same instant check the API performs, used only so the form can complain
// immediately instead of after a round trip. The server re-validates everything and
// stays the authority; this never decides authorization and never writes anything.
export function isValidLeaveRangeInput(startsOn, endsOn) {
  const start = parseDay(startsOn);
  const end = parseDay(endsOn);
  if (start === null || end === null) return false;
  // startsOn === endsOn is a valid ONE-DAY leave.
  return start <= end;
}

export function sortLeaveByCreatedDesc(requests) {
  return [...(Array.isArray(requests) ? requests : [])].sort((a, b) => {
    const at = a?.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b?.createdAt ? Date.parse(b.createdAt) : 0;
    if (Number.isNaN(at) || Number.isNaN(bt)) return 0;
    return bt - at;
  });
}

// Admin-side queue order: pending first, then newest first. Same rule the API
// applies, so the page and the API can never disagree about what is most urgent.
export function sortLeaveForAdmin(requests) {
  return sortLeaveByCreatedDesc(requests).sort((a, b) => {
    const ap = isPendingLeave(a) ? 0 : 1;
    const bp = isPendingLeave(b) ? 0 : 1;
    return ap - bp;
  });
}
