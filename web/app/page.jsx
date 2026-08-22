"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CalendarCheck,
  ShieldCheck,
  Sparkles,
  Phone,
  Star,
  BadgeCheck,
  ArrowRight,
  Megaphone,
  CheckCircle2,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ServiceCard from "@/components/ServiceCard";
import { api, fmtDate } from "@/lib/api";

const HERO_IMG =
  "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1920&q=80";

export default function HomePage() {
  const [services, setServices] = useState([]);
  const [announcements, setAnnouncements] = useState([]);

  useEffect(() => {
    api("/services").then((d) => setServices(d.services.slice(0, 6))).catch(() => {});
    api("/broadcasts/public").then((d) => setAnnouncements(d.broadcasts.slice(0, 3))).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      {/* Announcement ticker */}
      {announcements.length > 0 && (
        <div className="bg-brand-light border-b border-brand-soft">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5">
            {announcements.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm text-brand-dark">
                <Megaphone size={14} className="shrink-0" />
                <span className="font-semibold">{a.title || "Announcement"}:</span>
                <span className="truncate">{a.content}</span>
                <span className="shrink-0 text-xs text-brand opacity-70">— {fmtDate(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hero */}
      <section
        className="relative isolate overflow-hidden"
        style={{ backgroundImage: `url(${HERO_IMG})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-ink/90 via-ink/75 to-brand-deeper/70" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-24 sm:py-32 lg:py-40">
          <div className="max-w-2xl animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur border border-white/20">
              <Star size={13} className="fill-amber-400 text-amber-400" />
              Anoka's trusted window &amp; screen cleaning specialists
            </span>
            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.08] tracking-tight text-white">
              Sparkling windows.
              <br />
              <span className="text-clean-light">Spotless screens.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-200 leading-relaxed">
              Professional, streak-free window cleaning and screen services for homes
              and businesses across Anoka, MN 55303. Transparent pricing, online booking,
              and a clean guarantee we stand behind.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="btn btn-secondary !px-6 !py-3.5 !text-base shadow-lift">
                <CalendarCheck size={18} /> Book Now
              </Link>
              <Link href="/services" className="btn !px-6 !py-3.5 !text-base bg-white/10 text-white border border-white/30 hover:bg-white/20 hover:text-white backdrop-blur">
                View Services <ArrowRight size={16} />
              </Link>
              <a href="tel:17636204955" className="inline-flex items-center gap-2 text-sm font-semibold text-white/90 hover:text-white">
                <Phone size={16} className="text-clean-light" /> 1 763-620-4955
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
              {["Streak-free guarantee", "Locally owned & operated", "Free estimates"].map((t) => (
                <span key={t} className="inline-flex items-center gap-2 text-sm font-medium text-slate-200">
                  <CheckCircle2 size={16} className="text-clean-light" /> {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
              <Sparkles size={13} /> Our Services
            </span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">
              Cleaning done right, <span className="text-brand">every time</span>
            </h2>
            <p className="mt-3 text-muted leading-relaxed">
              Flat, transparent rates — no surprises. Most quotes are finalized after a
              quick walkthrough. Book online in under a minute.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <ServiceCard
                key={s.id}
                service={s}
                action={
                  <Link href="/signup" className="btn btn-outline btn-sm">
                    Book this
                  </Link>
                }
              />
            ))}
          </div>
        </div>
      </section>

      {/* Why choose us */}
      <section className="bg-white border-y border-line py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">
              Why choose <span className="text-clean">Trinitas-Cleaners?</span>
            </h2>
            <p className="mt-3 text-muted">A family-run business that treats your home like our own.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: ShieldCheck,
                title: "Streak-free guarantee",
                desc: "We use pro-grade tools and techniques. If you spot a streak, we'll come back and fix it — free.",
                tint: "bg-brand-light text-brand",
              },
              {
                icon: BadgeCheck,
                title: "Locally owned",
                desc: "Proudly serving Anoka, MN 55303 and nearby communities. Support a neighbor, not a franchise.",
                tint: "bg-clean-light text-clean",
              },
              {
                icon: CalendarCheck,
                title: "Easy online booking",
                desc: "Schedule, track, and view receipts from your customer portal — anytime, on any device.",
                tint: "bg-warnbg text-amber-600",
              },
            ].map((f) => (
              <div key={f.title} className="card p-6 text-center transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
                <span className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${f.tint}`}>
                  <f.icon size={26} />
                </span>
                <h3 className="mt-5 text-lg font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm text-muted leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-deeper px-6 py-12 sm:px-12 sm:py-16 text-center shadow-lift">
            <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full bg-white/5" />
            <div className="absolute -bottom-12 -left-8 h-56 w-56 rounded-full bg-white/5" />
            <h2 className="relative text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Ready for a cleaner home?
            </h2>
            <p className="relative mx-auto mt-3 max-w-lg text-brand-soft">
              Create a free account to book instantly, or call us — we'd love to chat
              about your project.
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="btn bg-white text-brand hover:bg-brand-light !px-6 !py-3.5 !text-base">
                <CalendarCheck size={18} /> Create Account &amp; Book
              </Link>
              <a href="tel:17636204955" className="btn !px-6 !py-3.5 !text-base bg-transparent text-white border border-white/40 hover:bg-white/10">
                <Phone size={18} /> 1 763-620-4955
              </a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}