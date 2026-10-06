"use client";

// The admin portal's navigation, in ONE place.
//
// Until now each of the 22 admin pages declared its own copy of this list, and those
// copies had drifted: /admin/leave and /admin/shifts appeared on only three pages
// each, /admin/payments on five, and /admin/community was missing from the
// community page's own sidebar. `adminNavLinks()` is now the only definition, so a
// destination can never again be reachable from one admin page and invisible from
// the next.
//
// WHAT IS DELIBERATELY NOT HERE. Two destinations are contextual children of a
// single page, not portal-wide navigation, and they stay local to the pages that own
// them rather than being flattened into every sidebar:
//   /admin/community/employee   — the employee-community moderation surface
//   /admin/content?page=faq     — the FAQ deep link inside the content manager
// Neither is lost; each page appends its own copy alongside adminNavLinks().
//
// ONE ICON PER DESTINATION. The duplicated arrays had drifted on icons too, so the
// value used by the MAJORITY of pages wins: Payments is Banknote (not
// BadgeDollarSign), Discounts is BadgePercent (not TicketPercent), Broadcasts is
// Megaphone (not BookOpen), Community is MessageCircle (not MessagesSquare).
//
// ORDERING is the business's, not a leftover from file-creation order: people and
// work first, then the money pages, then the employee-relations pages
// (Shifts, Leave, Resignation), then communication and content.

import {
  BadgeDollarSign,
  BadgePercent,
  Banknote,
  BookOpen,
  CalendarCheck,
  CalendarOff,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  MessageSquare,
  ReceiptText,
  Send,
  Star,
  Store,
  Users,
  UsersRound,
  Wrench,
} from "lucide-react";

// Exactly the admin destinations that exist, in one order, for every admin page.
export function adminNavLinks() {
  return [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/employees", label: "Employees", icon: UsersRound },
    { href: "/admin/users", label: "Customers", icon: Users },
    { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
    { href: "/admin/reviews", label: "Reviews", icon: Star },
    { href: "/admin/payments", label: "Payments", icon: Banknote },
    { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
    { href: "/admin/services", label: "Services", icon: Wrench },
    { href: "/admin/business", label: "Business Info", icon: Store },
    { href: "/admin/promotions", label: "Discounts", icon: BadgePercent },
    { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
    { href: "/admin/shifts", label: "Shifts", icon: Send },
    { href: "/admin/leave", label: "Leave", icon: CalendarOff },
    { href: "/admin/resignation", label: "Resignation", icon: CalendarOff },
    { href: "/admin/messages", label: "Messages", icon: MessageSquare },
    { href: "/admin/community", label: "Community", icon: MessageCircle },
    { href: "/admin/community/groups", label: "Groups", icon: UsersRound },
    { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
    { href: "/admin/content", label: "How It Works", icon: BookOpen },
  ];
}