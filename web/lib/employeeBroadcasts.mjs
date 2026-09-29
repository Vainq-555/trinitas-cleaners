// Pure, DOM-free view helpers for employee announcements (Phase 2B-2).
// No React imports, so they are unit-testable via `node --test`.
//
// These helpers are DISPLAY ONLY. They never authorize anything and never decide
// what an employee may see — `GET /employee/broadcasts` is already scoped to the
// session employee AND the employee audience, so every function here operates on
// rows the server has already approved.

// `announcementNavLabel` lives in ./employeeNavLabels.mjs and is imported from
// there directly, so there is exactly one import path for it.

// True only for an announcement the employee has not read yet.
//
// A missing `read` flag is treated as UNREAD rather than read: if the server ever
// omits it, the employee sees the message again (harmless) instead of silently
// losing track of it (harmful).
export function isUnread(announcement) {
  return announcement?.read !== true;
}

// How many announcements the employee has not read.
//
// Counted from the array the server actually returned, so the badge can never
// claim a notification that does not exist. Never invents a number.
export function unreadCount(announcements) {
  if (!Array.isArray(announcements)) return 0;
  return announcements.filter(isUnread).length;
}

// Read the badge count back off a nav label, so a test can prove the label and
// the count agree without rendering React. Returns 0 when there is no badge.
export function unreadCountFromLabel(label) {
  const match = /\((\d+)\)$/.exec(String(label ?? ""));
  return match ? Number(match[1]) : 0;
}

// Announcement vs notification, matching the label the customer feed already
// uses for the same `type` value.
export function typeLabel(announcement) {
  return announcement?.type === "notification" ? "Notification" : "Announcement";
}

// The unread pill text, or null when read (so the caller renders nothing rather
// than a misleading "Read" badge on every item).
export function unreadPill(announcement) {
  return isUnread(announcement) ? "New" : null;
}

export const EMPTY_TITLE = "No announcements right now.";
export const EMPTY_BODY = "When an administrator posts an announcement for employees, it will appear here.";
