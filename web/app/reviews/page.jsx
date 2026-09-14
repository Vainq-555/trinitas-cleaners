"use client";

import { useEffect, useState } from "react";
import { Star, MessageSquareQuote } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ReviewStars from "@/components/ReviewStars";
import { api, fmtDate } from "@/lib/api";

// Public, read-only full Approved Reviews page. GET /reviews returns only
// admin-approved reviews with the safe public field shape, so approval is the
// only gate that makes a review public. Renders every review it returns.
export default function ReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/reviews")
      .then((d) => setReviews(Array.isArray(d?.reviews) ? d.reviews : []))
      .catch(() => setReviews([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-12 flex-1">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            <Star size={13} /> Reviews
          </span>
          <h1 className="mt-4 page-title">Reviews</h1>
          <p className="mt-3 text-muted">Approved reviews from real Trinitas-Cleaners customers.</p>
        </div>

        {loading ? (
          <div className="empty-state mt-10">Loading reviews…</div>
        ) : reviews.length === 0 ? (
          <div className="card p-10 text-center mt-10">
            <Star size={32} className="mx-auto text-slate-300" />
            <p className="mt-3 font-semibold text-ink">No reviews yet.</p>
            <p className="text-sm text-muted">Check back soon for reviews from Trinitas-Cleaners customers.</p>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.map((r) => (
              <div key={r.id} className="card group p-6 flex flex-col transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
                <div className="flex items-start justify-between gap-2">
                  <ReviewStars rating={r.rating} />
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
        )}
      </main>
      <Footer />
    </div>
  );
}