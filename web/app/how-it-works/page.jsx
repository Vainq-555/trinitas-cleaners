import Link from "next/link";
import {
  Sparkles,
  CalendarCheck,
  ArrowRight,
  MessageSquare,
  LayoutDashboard,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CallUs from "@/components/CallUs";
import HowItWorksContent from "./HowItWorksContent";

export const metadata = {
  title: "How It Works | Trinitas-Cleaners — Simple Online Booking in Anoka, MN",
  description:
    "See how Trinitas-Cleaners works: create an account, request a service, get it approved, pay online or with cash, and receive a receipt. Locally owned in Anoka, MN 55303.",
};

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-12 flex-1">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            <Sparkles size={13} /> Getting Started
          </span>
          <h1 className="mt-4 page-title">How It Works</h1>
          <p className="mt-3 text-muted">
            Simple, transparent booking. Here&apos;s how a Trinitas-Cleaners request
            moves from account creation to a finished, receipted job.
          </p>
        </div>

        {/* Admin-controlled steps from the content API */}
        <HowItWorksContent />

        {/* Helpful customer note */}
        <section className="mt-12 max-w-3xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink">Track it from your dashboard</h2>
          <div className="mt-4 card p-6">
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-light text-brand">
                  <LayoutDashboard size={18} />
                </span>
                <p className="text-sm text-slate-700 leading-relaxed">
                  <span className="font-semibold text-ink">Check your booking status</span> — your
                  customer dashboard shows the current status of every request.
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-clean-light text-clean">
                  <MessageSquare size={18} />
                </span>
                <p className="text-sm text-slate-700 leading-relaxed">
                  <span className="font-semibold text-ink">Message Trinitas directly</span> — ask
                  questions or coordinate details through your dashboard&apos;s messaging.
                </p>
              </li>
            </ul>
            <Link href="/dashboard" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-dark">
              Open your dashboard <ArrowRight size={15} />
            </Link>
          </div>
        </section>

        {/* CTA section */}
        <section className="mt-14">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-deeper px-6 py-12 sm:px-12 text-center shadow-lift">
            <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full bg-white/5" />
            <div className="absolute -bottom-12 -left-8 h-56 w-56 rounded-full bg-white/5" />
            <h2 className="relative text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Ready to get started?
            </h2>
            <p className="relative mx-auto mt-3 max-w-lg text-brand-soft">
              Create a free account to book online, browse services, or reach out —
              we&apos;re happy to help.
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="btn bg-white text-brand hover:bg-brand-light !px-6 !py-3.5 !text-base">
                <CalendarCheck size={18} /> Book Online
              </Link>
              <Link href="/services" className="btn !px-6 !py-3.5 !text-base bg-white/10 text-white border border-white/30 hover:bg-white/20">
                View Services <ArrowRight size={16} />
              </Link>
              <CallUs className="btn !px-6 !py-3.5 !text-base bg-transparent text-white border border-white/40 hover:bg-white/10" iconSize={18} />
              <Link href="/contact" className="btn !px-6 !py-3.5 !text-base bg-white/10 text-white border border-white/30 hover:bg-white/20">
                <MessageSquare size={16} /> Contact
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}