"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Phone, Sparkles, LogIn, UserPlus, LayoutDashboard } from "lucide-react";
import { useAuth, homeForRole } from "@/lib/auth";
import { useBusinessInfo } from "@/lib/businessInfo";
import { telHref } from "@/lib/businessInfoData";

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { business } = useBusinessInfo();
  const [open, setOpen] = useState(false);

  const isDashboard = pathname.startsWith("/dashboard");
  const isAdmin = pathname.startsWith("/admin");
  const isEmployee = pathname.startsWith("/employee");

  // Portal session view for any portal area. customer → /dashboard and
  // admin → /admin behave exactly as before; employee gets its own portal.
  const inPortal = isDashboard || isAdmin || isEmployee;
  const portalLabel = isAdmin ? "Admin Portal" : isEmployee ? "Employee Portal" : "Customer Portal";

  const portalHref = homeForRole(user?.role);
  const portalCta = user?.role === "admin"
    ? "Admin Portal"
    : user?.role === "employee"
      ? "Employee Portal"
      : "My Dashboard";

  const publicLinks = [
    { href: "/", label: "Home" },
    { href: "/services", label: "Services" },
    { href: "/how-it-works", label: "How It Works" },
    { href: "/faq", label: "FAQ" },
    { href: "/service-areas", label: "Service Areas" },
    { href: "/announcements", label: "Announcements" },
    { href: "/contact", label: "Contact" },
  ];

  const link = (l) =>
    `text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
      pathname === l.href ? "text-brand bg-brand-light" : "text-slate-600 hover:text-brand hover:bg-slate-100"
    }`;

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  return (
    <header className="nav sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 group" onClick={() => setOpen(false)}>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white shadow-card group-hover:bg-brand-dark transition-colors">
              <Sparkles size={18} />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-ink">
              Trinitas<span className="text-brand">-</span>Cleaners
            </span>
          </Link>

          {/* Desktop: portal session / public links */}
          {inPortal ? (
            <nav className="hidden md:flex items-center gap-3">
              <span className="text-sm text-muted">
                {portalLabel} ·{" "}
                <span className="font-semibold text-ink">{user?.name}</span>
              </span>
              <Link href="/" className="btn btn-ghost btn-sm">View public site</Link>
              <button onClick={handleLogout} className="btn btn-outline btn-sm">Log out</button>
            </nav>
          ) : (
            <nav className="hidden md:flex items-center gap-1">
              {publicLinks.map((l) => (
                <Link key={l.href} href={l.href} className={link(l)}>{l.label}</Link>
              ))}
              <span className="mx-2 h-5 w-px bg-line" />
              <a href={telHref(business.phone)} className="hidden lg:flex items-center gap-1.5 text-sm font-medium text-clean hover:text-clean-dark">
                <Phone size={15} /> {business.phone}
              </a>
              {user ? (
                <Link
                  href={portalHref}
                  className="btn btn-primary btn-sm ml-1"
                >
                  <LayoutDashboard size={15} />
                  {portalCta}
                </Link>
              ) : (
                <div className="flex items-center gap-2 ml-2">
                  <Link href="/login" className="btn btn-ghost btn-sm">
                    <LogIn size={15} /> Log In
                  </Link>
                  <Link href="/signup" className="btn btn-primary btn-sm">
                    <UserPlus size={15} /> Sign Up
                  </Link>
                </div>
              )}
            </nav>
          )}

          {/* Mobile hamburger */}
          <button
            className="md:hidden grid h-10 w-10 place-items-center rounded-lg text-ink hover:bg-slate-100"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-line bg-white animate-fade-up">
          <div className="px-4 py-4 space-y-1">
            {inPortal ? (
              <>
                <p className="px-3 py-2 text-sm text-muted">
                  {portalLabel} ·{" "}
                  <span className="font-semibold text-ink">{user?.name}</span>
                </p>
                <Link href="/" className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100" onClick={() => setOpen(false)}>
                  View public site
                </Link>
                <button onClick={handleLogout} className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-danger hover:bg-dangerbg">
                  Log out
                </button>
              </>
            ) : (
              <>
                {publicLinks.map((l) => (
                  <Link key={l.href} href={l.href} className={link(l) + " block"} onClick={() => setOpen(false)}>
                    {l.label}
                  </Link>
                ))}
                <div className="pt-3 mt-2 border-t border-line grid gap-2">
                  {user ? (
                    <Link href={portalHref} className="btn btn-primary" onClick={() => setOpen(false)}>
                      <LayoutDashboard size={16} /> {portalCta}
                    </Link>
                  ) : (
                    <>
                      <Link href="/login" className="btn btn-outline" onClick={() => setOpen(false)}>
                        <LogIn size={16} /> Log In
                      </Link>
                      <Link href="/signup" className="btn btn-primary" onClick={() => setOpen(false)}>
                        <UserPlus size={16} /> Sign Up
                      </Link>
                    </>
                  )}
                  <a href={telHref(business.phone)} className="btn btn-secondary">
                    <Phone size={16} /> {business.phone}
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}