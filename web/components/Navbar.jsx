"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Phone, Sparkles, LogIn, UserPlus, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const isDashboard = pathname.startsWith("/dashboard");
  const isAdmin = pathname.startsWith("/admin");

  const publicLinks = [
    { href: "/", label: "Home" },
    { href: "/services", label: "Services" },
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
          {isDashboard || isAdmin ? (
            <nav className="hidden md:flex items-center gap-3">
              <span className="text-sm text-muted">
                {isAdmin ? "Admin Portal" : "Customer Portal"} ·{" "}
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
              <a href="tel:17636204955" className="hidden lg:flex items-center gap-1.5 text-sm font-medium text-clean hover:text-clean-dark">
                <Phone size={15} /> 1 763-620-4955
              </a>
              {user ? (
                <Link
                  href={user.role === "admin" ? "/admin" : "/dashboard"}
                  className="btn btn-primary btn-sm ml-1"
                >
                  <LayoutDashboard size={15} />
                  {user.role === "admin" ? "Admin Portal" : "My Dashboard"}
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
            {isDashboard || isAdmin ? (
              <>
                <p className="px-3 py-2 text-sm text-muted">
                  {isAdmin ? "Admin Portal" : "Customer Portal"} ·{" "}
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
                    <Link href={user.role === "admin" ? "/admin" : "/dashboard"} className="btn btn-primary" onClick={() => setOpen(false)}>
                      <LayoutDashboard size={16} /> {user.role === "admin" ? "Admin Portal" : "My Dashboard"}
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
                  <a href="tel:17636204955" className="btn btn-secondary">
                    <Phone size={16} /> 1 763-620-4955
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