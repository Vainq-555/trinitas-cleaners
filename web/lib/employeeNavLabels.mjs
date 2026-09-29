// Employee nav label helpers (Phase 2B-2). Pure and DOM-free so the badge
// wording is unit-testable without rendering React.
//
// Kept in its own module (rather than in the .jsx that holds the icon
// components) so `node --test` can import it directly.

// "Announcements" with a real unread count appended, or plain "Announcements"
// when nothing is unread.
//
// The count comes from the server-returned announcement list, never a guess, and
// is omitted entirely at zero so the nav does not show a distracting "(0)".
export function announcementNavLabel(unreadCount) {
  const n = Number(unreadCount);
  if (!Number.isFinite(n) || n <= 0) return "Announcements";
  return `Announcements (${n})`;
}
