"use client";

import Link from "next/link";
import { Sparkles, MapPin, Phone, Mail, CalendarDays, Heart } from "lucide-react";

const quickLinks = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services & Pricing" },
  { href: "/announcements", label: "Announcements" },
  { href: "/contact", label: "Contact" },
  { href: "/login", label: "Customer Login" },
  { href: "/signup", label: "Create Account" },
];

const serviceLinks = [
  "Window Cleaning",
  "Screen Cleaning",
  "Full Window Package",
  "Carpet Cleaning",
  "Pressure Washing",
];

export default function Footer() {
  return (
    <footer className="footer bg-brand-deeper text-white mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white">
                <Sparkles size={18} />
              </span>
              <span className="text-lg font-extrabold tracking-tight">Trinitas-Cleaners</span>
            </div>
            <p className="mt-4 text-sm text-brand-soft leading-relaxed">
              Locally owned window &amp; screen cleaning service. Sparkling results,
              honest pricing, and a streak-free guarantee you can trust.
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-soft mb-4">Quick Links</h3>
            <ul className="space-y-2.5">
              {quickLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-slate-300 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-soft mb-4">Services</h3>
            <ul className="space-y-2.5">
              {serviceLinks.map((s) => (
                <li key={s}>
                  <Link href="/services" className="text-sm text-slate-300 hover:text-white transition-colors">
                    {s}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-brand-soft mb-4">Contact</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3 text-sm text-slate-300">
                <MapPin size={16} className="mt-0.5 text-clean shrink-0" />
                Anoka, Minnesota 55303
              </li>
              <li>
                <a href="tel:17636204955" className="flex items-center gap-3 text-sm text-slate-300 hover:text-white transition-colors">
                  <Phone size={16} className="text-clean shrink-0" /> 1 763-620-4955
                </a>
              </li>
              <li>
                <a href="mailto:trinitascleaner@gmail.com" className="flex items-center gap-3 text-sm text-slate-300 hover:text-white transition-colors">
                  <Mail size={16} className="text-clean shrink-0" /> trinitascleaner@gmail.com
                </a>
              </li>
              <li className="flex items-center gap-3 text-sm text-slate-300">
                <CalendarDays size={16} className="text-clean shrink-0" /> Mon–Sat · 8 AM – 6 PM
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <p>© {new Date().getFullYear()} Trinitas-Cleaners · Anoka, MN 55303</p>
          <p className="flex items-center gap-1.5">
            Made with <Heart size={12} className="text-danger fill-danger" /> for sparkling windows
          </p>
        </div>
      </div>
    </footer>
  );
}