"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarCheck, BadgeDollarSign, Sparkles, Phone } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ServiceCard from "@/components/ServiceCard";
import { api } from "@/lib/api";

export default function ServicesPage() {
  const [services, setServices] = useState([]);

  useEffect(() => {
    api("/services").then((d) => setServices(d.services)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-12 flex-1">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            <BadgeDollarSign size={13} /> Transparent Pricing
          </span>
          <h1 className="mt-4 page-title">Services &amp; Pricing</h1>
          <p className="mt-3 text-muted">
            Every job is priced upfront. Create an account to book — personalized rates
            may apply based on your property.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              action={
                <Link href="/signup" className="btn btn-primary btn-sm">
                  <CalendarCheck size={14} /> Book this
                </Link>
              }
            />
          ))}
        </div>

        <div className="mt-12 card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-clean-light text-clean">
              <Sparkles size={20} />
            </span>
            <div>
              <h3 className="font-bold text-ink">Need something custom?</h3>
              <p className="text-sm text-muted">
                Use the contact page or call — we'll build a quote around your home or business.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <a href="tel:17636204955" className="btn btn-outline">
              <Phone size={16} /> 1 763-620-4955
            </a>
            <Link href="/contact" className="btn btn-primary">Contact us</Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}