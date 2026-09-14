"use client";

import { useEffect, useState } from "react";
import { Star, MessageSquareQuote } from "lucide-react";
import { api, fmtDate } from "@/lib/api";

// Approved-only reviews, newest first, limited client-side for the Home page.
const MAX_REVIEWS = 3;

function Stars({ value, size = 15 }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
      ))}
    </span>
  );
}

// Public, read-only approved-reviews showcase. The backend GET /reviews
// already returns only admin-approved reviews, so approval is the only gate
// that makes a review public. Renders nothing while loading, on error, or
// when there are no approved reviews yet.
export default function PublicReviews() {
  const [reviews, setReviews] = useState(null);

  useEffect(() => {
    api("/reviews")
      .then((d) => setReviews(Array.isArray(d?.reviews) ? d.reviews : []))
      .catch(() => setReviews([]));
  }, []);

  if (!reviews || reviews.length === 0) return null;
  const shown = reviews.slice(0, MAX_REVIEWS);

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">
            What Our <span className="text-brand">Customers Say</span>
          </h2>
          <p className="mt-3 text-muted">Approved reviews from real Trinitas-Cleaners customers.</p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <div key={r.id} className="card group p-6 flex flex-col transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
              <div className="flex items-start justify-between gap-2">
                <Stars value={r.rating} />
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-light text-brand">
                  <MessageSquareQuote size={18} />
                </span>
              </div>
              {r.title && <h3 className="mt-4 font-bold text-ink">{r.title}</h3>}
              <p className="mt-2 text-sm text-slate-700 leading-relaxed flex-1">{r.body}</p>
              <div className="mt-5 pt-4 border-t border-line text-xs text-muted flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{r.customer?.name}</span>
                <span className="text-right">
                  {r.service?.name}
                  <span className="block opacity-70">{fmtDate(r.createdAt)}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}