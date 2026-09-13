"use client";

import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { api } from "@/lib/api";

// Deterministic resilience fallback used ONLY when the admin content API is
// unreachable or has no records. Admin-controlled API content is authoritative;
// this fallback simply restates confirmed Trinitas behavior in simple terms.
const FALLBACK_STEPS = [
  {
    sectionKey: "create-account",
    title: "Create an account",
    body: "Create a free account using your name, email, and password. Your account lets you request services, track bookings, and receive updates.",
  },
  {
    sectionKey: "request-service",
    title: "Request a service",
    body: "Choose a service and a date, then submit your request. A Trinitas-Cleaners representative reviews every request before confirming it.",
  },
  {
    sectionKey: "approval",
    title: "Get approved",
    body: "Accepted requests move forward. If a request cannot be accepted, it is declined and you can reach out through your dashboard for help.",
  },
  {
    sectionKey: "payment",
    title: "Pay for your service",
    body: "Online payments are handled by a secure checkout that becomes available once your request is accepted. Cash payments are arranged directly with Trinitas-Cleaners.",
  },
  {
    sectionKey: "receipt",
    title: "Get your receipt",
    body: "A receipt is issued for every completed payment and is available in your dashboard.",
  },
];

const TINTS = [
  "bg-brand-light text-brand",
  "bg-clean-light text-clean",
  "bg-warnbg text-amber-600",
];

export default function HowItWorksContent() {
  const [sections, setSections] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api("/content/how-it-works")
      .then((d) => setSections(Array.isArray(d?.sections) ? d.sections : []))
      .catch(() => {
        setFailed(true);
        setSections([]);
      });
  }, []);

  const steps =
    sections && sections.length > 0 ? sections.map((s, i) => ({ ...s, _index: i })) : FALLBACK_STEPS;

  return (
    <section className="mt-12 max-w-3xl">
      {sections === null ? (
        <div className="empty-state">Loading steps…</div>
      ) : (
        <ol className="space-y-6">
          {steps.map((s, i) => (
            <li key={s.id || s.sectionKey} className="card p-6">
              <div className="flex items-start gap-4">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl font-extrabold ${TINTS[i % TINTS.length]}`}>
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-bold text-ink">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-muted leading-relaxed">{s.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {failed && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
          <CircleAlert size={14} className="text-amber-600" />
          The latest steps couldn&apos;t be loaded right now — showing the standard process.
        </p>
      )}
    </section>
  );
}