"use client";

// The employee portal's navigation, in ONE place (Phase 2B-2).
//
// Until now each employee page declared its own copy of this list, so adding
// Announcements would have meant a third copy to keep in sync — and a nav that
// quietly differs between pages. `employeeNavLinks(unreadCount)` is now the only
// definition, used by every page under /employee.
//
// The unread count is a REAL count of unread rows the server returned for this
// employee. It is never fabricated, and it is omitted at zero.

import {
  CalendarClock,
  ClipboardList,
  HardHat,
  Megaphone,
  MessageSquare,
  CalendarDays,
  MessagesSquare,
} from "lucide-react";
import { announcementNavLabel } from "@/lib/employeeNavLabels.mjs";

// Exactly the employee destinations that exist, in the order the business
// specified: dashboard, assigned work, what you can work, work you can ask for,
// the employee community, announcements, contact. Still no profile or time-
// tracking links, because those features do not exist and a nav entry pointing
// at nothing is worse than a missing one. No customer or admin destinations
// either.
//
// Ordering is the business's, not a leftover from file creation order.
export function employeeNavLinks(unreadCount = 0) {
  return [
    { href: "/employee", label: "Dashboard", icon: HardHat },
    { href: "/employee/assignments", label: "My Assigned Services", icon: ClipboardList },
    { href: "/employee/availability", label: "My Availability", icon: CalendarClock },
    { href: "/employee/shifts", label: "Available Shifts", icon: CalendarDays },
    { href: "/employee/community", label: "Community", icon: MessagesSquare },
    { href: "/employee/broadcasts", label: announcementNavLabel(unreadCount), icon: Megaphone },
    { href: "/employee/messages", label: "Contact Admin", icon: MessageSquare },
  ];
}
