import Link from "next/link";
import {
  MapPin,
  Map,
  CalendarCheck,
  ShieldCheck,
  ArrowRight,
  MessageSquare,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CallUs from "@/components/CallUs";
import { ServiceAreasTeaser, ServiceAreaCards, BusinessInfoCards } from "./ServiceAreasContent";

export const metadata = {
  title: "Service Areas | Trinitas-Cleaners — Anoka, MN & Surrounding Communities",
  description:
    "Proudly serving Anoka, Minnesota 55303 and surrounding communities. Trinitas Cleaners is a locally owned window and screen cleaning company. Call 1 763-620-4955 to confirm service for your address.",
};

export default function ServiceAreasPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-12 flex-1">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            <MapPin size={13} /> Service Area
          </span>
          <h1 className="mt-4 page-title">Service Areas</h1>
          <ServiceAreasTeaser />
        </div>

        <ServiceAreaCards />

        <section className="mt-12 max-w-3xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink">Surrounding Communities</h2>
          <div className="mt-4 card p-6">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-clean-light text-clean">
                <Map size={22} />
              </span>
              <div>
                <p className="text-sm text-muted leading-relaxed">
                  We also serve surrounding communities near Anoka. Coverage can vary by
                  location, so if you're outside Anoka, contact us and we'll confirm whether
                  we can serve your address.
                </p>
                <Link href="/contact" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-dark">
                  Confirm coverage for your address <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <div className="card p-6 sm:p-8 bg-gradient-to-br from-brand to-brand-deeper text-white">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10">
                  <ShieldCheck size={22} />
                </span>
                <div>
                  <h2 className="text-xl font-bold">Not sure if we cover you?</h2>
                  <p className="mt-2 text-sm text-brand-soft leading-relaxed">
                    Customers outside Anoka can contact us to confirm service availability
                    for their address — we'd love to help.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Link href="/contact" className="btn bg-white text-brand hover:bg-brand-light">
                  <MessageSquare size={16} /> Contact Us
                </Link>
                <CallUs className="btn bg-transparent text-white border border-white/40 hover:bg-white/10" iconSize={16} label="Call" />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink">Business Information</h2>
          <BusinessInfoCards />
        </section>

        <section className="mt-14">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-deeper px-6 py-12 sm:px-12 text-center shadow-lift">
            <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full bg-white/5" />
            <div className="absolute -bottom-12 -left-8 h-56 w-56 rounded-full bg-white/5" />
            <h2 className="relative text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Ready for a cleaner home?
            </h2>
            <p className="relative mx-auto mt-3 max-w-lg text-brand-soft">
              Book online in under a minute, or call us to confirm service for your address.
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="btn bg-white text-brand hover:bg-brand-light !px-6 !py-3.5 !text-base">
                <CalendarCheck size={18} /> Book Online
              </Link>
              <CallUs className="btn !px-6 !py-3.5 !text-base bg-transparent text-white border border-white/40 hover:bg-white/10" iconSize={18} />
              <Link href="/contact" className="btn !px-6 !py-3.5 !text-base bg-white/10 text-white border border-white/30 hover:bg-white/20">
                Contact Us <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}