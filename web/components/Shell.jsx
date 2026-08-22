"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, Sparkles, X, LogOut, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";

/**
 * Modern app shell with a fixed, collapsible sidebar (desktop) and a slide-out
 * drawer (mobile). Used by both the Customer and Admin portals.
 *
 * props: { links: [{href,label,icon}], sections: [string], title, subtitle, children }
 */
export default function Shell({ links, sections, title, subtitle, children }) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  const isActive = (href) => pathname === href || pathname.startsWith(href + "/");

  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      {sections?.map((s) => (
        <div key={s} className="px-3 pt-4 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
          {collapsed ? "···" : s}
        </div>
      ))}
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          title={l.label}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive(l.href)
              ? "bg-brand text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-brand"
          } ${collapsed ? "justify-center" : ""}`}
        >
          {l.icon && <l.icon size={18} className="shrink-0" />}
          {!collapsed && <span className="truncate">{l.label}</span>}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-canvas">
      {/* Desktop sidebar */}
      <aside
        className={`sidebar fixed inset-y-0 left-0 z-40 hidden lg:flex flex-col bg-white border-r border-line transition-all duration-200 ${
          collapsed ? "w-[76px]" : "w-[248px]"
        }`}
      >
        <div className={`flex h-16 items-center border-b border-line ${collapsed ? "justify-center" : "px-4"}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-white">
              <Sparkles size={18} />
            </span>
            {!collapsed && (
              <span className="text-[15px] font-extrabold tracking-tight text-ink truncate">
                Trinitas<span className="text-brand">-</span>Cleaners
              </span>
            )}
          </div>
        </div>
        {nav}
        <div className={`border-t border-line p-3 ${collapsed ? "text-center" : ""}`}>
          <button
            className="btn btn-ghost btn-sm w-full"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Toggle sidebar"
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Mobile overlay + drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}
      <aside
        className={`sidebar lg:hidden fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-white shadow-lift transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
              <Sparkles size={18} />
            </span>
            <span className="text-[15px] font-extrabold tracking-tight text-ink">
              Trinitas<span className="text-brand">-</span>Cleaners
            </span>
          </div>
          <button className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-slate-100" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        {nav}
      </aside>

      {/* Main content */}
      <div className={`transition-all duration-200 ${collapsed ? "lg:pl-[76px]" : "lg:pl-[248px]"}`}>
        {/* Top bar */}
        <div className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 sm:px-6 backdrop-blur">
          <button
            className="lg:hidden grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-slate-100"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="hidden sm:block truncate text-xs text-muted">{subtitle}</p>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="btn btn-ghost btn-sm hidden sm:inline-flex">
              <ExternalLink size={14} /> View site
            </Link>
            <button onClick={handleLogout} className="btn btn-outline btn-sm">
              <LogOut size={14} /> <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>

        <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}