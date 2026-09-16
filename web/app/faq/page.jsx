"use client";

import { useEffect, useState } from "react";
import { CircleHelp } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { api } from "@/lib/api";

// Public FAQ page. Content is admin-managed through the existing
// ContentSection system (page = "faq", global scope). GET /content/faq returns
// only active sections ordered by order; title = question, body = answer.
export default function FaqPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api("/content/faq")
      .then((d) => setItems(Array.isArray(d?.sections) ? d.sections : []))
      .catch(() => {
        setFailed(true);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-12 flex-1">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            <CircleHelp size={13} /> FAQ
          </span>
          <h1 className="mt-4 page-title">Frequently Asked Questions</h1>
          <p className="mt-3 text-muted">
            Answers to common questions about booking, services, pricing, and payments.
          </p>
        </div>

        {loading ? (
          <div className="empty-state mt-10">Loading frequently asked questions…</div>
        ) : failed ? (
          <div className="card p-10 text-center mt-10">
            <CircleHelp size={32} className="mx-auto text-slate-300" />
            <p className="mt-3 font-semibold text-ink">Couldn't load FAQ right now.</p>
            <p className="text-sm text-muted">Please try again later.</p>
          </div>
        ) : items.length === 0 ? (
          <div className="card p-10 text-center mt-10">
            <CircleHelp size={32} className="mx-auto text-slate-300" />
            <p className="mt-3 font-semibold text-ink">No FAQs yet.</p>
            <p className="text-sm text-muted">Questions and answers will appear here soon.</p>
          </div>
        ) : (
          <div className="mt-10 max-w-3xl space-y-3">
            {items.map((s) => (
              <details key={s.id} className="card overflow-hidden group">
                <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-5 py-4 font-semibold text-ink list-none">
                  <span>{s.title}</span>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light text-brand transition-transform group-open:rotate-45">
                    <CircleHelp size={14} />
                  </span>
                </summary>
                <div className="border-t border-line px-5 py-4 text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {s.body}
                </div>
              </details>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}