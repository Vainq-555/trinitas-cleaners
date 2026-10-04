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
    title: "Welcome! Let's get you started.",
    body: "Hey there! Welcome to Trinitas. Create your free account and you'll be ready to request a service, keep up with your bookings, view your receipts, and stay connected with us along the way.",
  },
  {
    sectionKey: "request-service",
    title: "Tell us what you need.",
    body: "Have something you'd like us to take care of? Once you're logged in, reach out and tell the Trinitas admin what you need. You can describe the work, ask questions, and we'll talk through the service and pricing, including any applicable taxes, so we can make sure everything is clear before moving forward.",
  },
  {
    sectionKey: "approval",
    title: "Hey, have you booked it?",
    body: "Once you've shared what you need, we'll review your booking and make sure all the details look right. If everything is good to go, the Trinitas admin will approve your booking and you'll be ready to move on to payment.",
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