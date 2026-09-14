"use client";

import Link from "next/link";
import { Phone, Mail, MapPin, Clock, MessageSquare, CalendarDays } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useBusinessInfo } from "@/lib/businessInfo";
import { telHref, formatAddressLong, splitHoursRow } from "@/lib/businessInfoData";

export default function ContactPage() {
  const { business } = useBusinessInfo();
  const week = splitHoursRow(business.hoursWeek);
  const weekend = splitHoursRow(business.hoursWeekend);
  const cards = [
    {
      icon: Phone,
      title: "Call us",
      line1: business.phone,
      line2: "Tap to call — we answer fast",
      href: telHref(business.phone),
      tint: "bg-brand-light text-brand",
    },
    {
      icon: Mail,
      title: "Email us",
      line1: business.email,
      line2: business.responseTime,
      href: `mailto:${business.email}`,
      tint: "bg-clean-light text-clean",
    },
    {
      icon: MapPin,
      title: "Service area",
      line1: formatAddressLong(business),
      line2: "And surrounding communities",
      href: null,
      tint: "bg-warnbg text-amber-600",
    },
  ];
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-12 flex-1">
        <div className="max-w-2xl">
          <h1 className="page-title">Contact Us</h1>
          <p className="mt-3 text-muted">
            Questions, custom requests, or a free quote? We'd love to hear from you.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {cards.map((c) => (
            <div key={c.title} className="card p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
              <span className={`grid h-12 w-12 place-items-center rounded-xl ${c.tint}`}>
                <c.icon size={22} />
              </span>
              <h3 className="mt-4 font-bold text-ink">{c.title}</h3>
              <p className="mt-1 font-semibold text-brand">{c.line1}</p>
              <p className="text-sm text-muted">{c.line2}</p>
              {c.href && (
                <a href={c.href} className="btn btn-outline btn-sm mt-4">Get in touch</a>
              )}
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand">
                <Clock size={18} />
              </span>
              <h3 className="font-bold text-ink">Business hours</h3>
            </div>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-700">
              <li className="flex items-center justify-between border-b border-line pb-2">
                <span className="flex items-center gap-2"><CalendarDays size={14} className="text-clean" /> {week ? week.days : business.hoursWeek}</span>
                {week != null && <span className="font-semibold">{week.time}</span>}
              </li>
              <li className="flex items-center justify-between">
                <span>{weekend ? weekend.days : business.hoursWeekend}</span>
                {weekend != null && <span className="font-semibold text-muted">{weekend.time}</span>}
              </li>
            </ul>
            <p className="mt-4 text-xs text-muted">
              Seasonal hours change for holidays — always check our{" "}
              <Link href="/announcements" className="text-brand font-semibold">Announcements</Link> page.
            </p>
          </div>

          <div className="card p-6 bg-gradient-to-br from-brand to-brand-deeper text-white">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10">
                <MessageSquare size={18} />
              </span>
              <h3 className="font-bold">Already a customer?</h3>
            </div>
            <p className="mt-3 text-sm text-brand-soft leading-relaxed">
              Message us directly from your customer dashboard — perfect for questions
              about bookings, pricing, or custom requests.
            </p>
            <Link href="/dashboard/messages" className="btn bg-white text-brand hover:bg-brand-light mt-5">
              <MessageSquare size={16} /> Open messaging
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}