// Employee available-shift view helpers (Phase 2B-4). Pure and DOM-free so the
// request-state rules are unit-testable without rendering React.
//
// Kept in its own module (rather than in the .jsx) so `node --test` can import
// it directly, matching the lib/employee*.mjs convention.
//
// NOTHING HERE DECIDES AUTHORIZATION. A shift's visibility, whether it is
// closed, and whether it is already assigned are all decided server-side and
// arrive as fields. These helpers only PRESENT them, so there is no browser-side
// rule that could be trusted with access control — and no way for a client edit
// to reveal a shift the server did not send.

export const REQUEST_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  DECLINED: "declined",
};

export const SHIFTS_EMPTY_TITLE = "No available shifts right now.";
export const SHIFTS_EMPTY_BODY =
  "When the admin publishes a shift you can request it, and your request status will appear here.";

// A request is only "requested" while it is genuinely pending. An unknown status
// (for example one added by a future release) is reported as pending rather
// than silently treated as approved or declined, so a new state can never be
// mis-reported to an employee as a decision.
export function requestStatusLabel(status) {
  switch (status) {
    case REQUEST_STATUS.APPROVED:
      return "Approved";
    case REQUEST_STATUS.DECLINED:
      return "Declined";
    case REQUEST_STATUS.REQUESTED:
      return "Requested";
    default:
      return "Requested";
  }
}

// Tailwind classes per status. Kept here so a new status cannot be added
// without also deciding how it looks.
export function requestStatusClass(status) {
  switch (status) {
    case REQUEST_STATUS.APPROVED:
      return "bg-warnbg text-amber-700";
    case REQUEST_STATUS.DECLINED:
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-brand-light text-brand";
  }
}

// "When can I still ask for this?" — the ONLY input is the server's own
// `canRequest` plus whether a request already exists. A shift that is assigned
// to somebody else, closed, or expired arrives without canRequest, so it is
// never offered as claimable.
export function canRequestShift(shift) {
  if (!shift) return false;
  if (shift.myRequest) return false;
  return shift.canRequest === true;
}

// Why a shift cannot be requested, for the explanatory line on the card.
// Ordered from most specific to least, and every branch is a fact the server
// sent — never a guess made in the browser.
export function shiftUnavailableReason(shift) {
  if (!shift) return null;
  if (shift.myRequest) {
    return `You already requested this shift — ${requestStatusLabel(shift.myRequest.status).toLowerCase()}.`;
  }
  if (shift.closesAt && new Date(shift.closesAt) <= new Date()) {
    return "This shift is closed for requests.";
  }
  if (shift.assignedEmployeeId) {
    return "This shift has already been assigned.";
  }
  if (shift.canRequest !== true) return "This shift is not open for requests.";
  return null;
}
