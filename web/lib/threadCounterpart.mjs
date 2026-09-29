// Admin thread counterpart labeling (Phase 2B-3). Pure and DOM-free so the
// labeling rules are unit-testable without rendering React.
//
// Kept in its own module (rather than inside the admin page) so `node --test`
// can import it directly, matching the lib/employee*.mjs convention.
//
// The ONLY input is `counterpartType`, which the server sets from the stored
// User.role (api/src/controllers/messages.js → adminListThreads). Nothing here
// inspects a name, an email or a display string: an employee named "Support"
// is still an employee, and a customer is never relabeled because of one.

export const COUNTERPART_TYPES = { CUSTOMER: "customer", EMPLOYEE: "employee" };

// Fail-safe: a thread with no counterpartType is reported as a customer
// thread, which is exactly what the admin UI did before Phase 2B-3. That keeps
// every existing customer thread displaying as a customer thread instead of
// degrading to an empty label.
export function isEmployeeThread(thread) {
  return thread?.counterpartType === COUNTERPART_TYPES.EMPLOYEE;
}

// Short badge text for the thread list.
export function counterpartBadge(thread) {
  return isEmployeeThread(thread) ? "Employee" : "Customer";
}

// Sentence shown under the counterpart name in the conversation header.
export function counterpartSubtitle(thread) {
  return isEmployeeThread(thread) ? "Employee conversation" : "Customer conversation";
}
