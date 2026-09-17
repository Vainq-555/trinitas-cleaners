"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  Star, CalendarCheck2,
  MessageCircle,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/reviews", label: "My Reviews", icon: Star },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/community", label: "Community", icon: MessageCircle },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const reviewStatusStyles = {
  pending: "bg-warnbg text-amber-700 border border-amber-200",
  approved: "bg-okbg text-clean-dark border border-green-200",
  rejected: "bg-dangerbg text-danger border border-red-200",
};

const reviewStatusNotes = {
  pending: "Awaiting approval — not public yet.",
  approved: "Approved and visible to everyone.",
  rejected: "This review was not approved.",
};

// Local moderation-status chip for reviews. Deliberately separate from the
// booking StatusBadge (which only understands booking statuses).
function ReviewStatus({ status }) {
  const label = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${reviewStatusStyles[status] || "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

// Read-only star rating display.
function Stars({ value, size = 16 }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
      ))}
    </span>
  );
}

// Keyboard-accessible 1–5 rating control. Native buttons stay focusable and
// trigger on Enter/Space; selected state is shown by filled stars, an
// aria-pressed marker, and an explicit "n / 5" readout.
function RatingSelector({ value, onChange }) {
  return (
    <div role="group" aria-label="Rating, 1 to 5 stars" className="flex flex-wrap items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          aria-pressed={value === n}
          onClick={() => onChange(n)}
          className={`rounded p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
            n <= (value || 0) ? "text-amber-400" : "text-slate-300 hover:text-amber-300"
          }`}
        >
          <Star size={26} strokeWidth={1.5} className={n <= (value || 0) ? "fill-amber-400" : ""} />
        </button>
      ))}
      <span className="ml-2 text-sm font-semibold text-ink" aria-live="polite">
        {value ? `${value} / 5` : "Select a rating"}
      </span>
    </div>
  );
}

// One review form per eligible (worked, unarchived, unreviewed) booking.
function EligibleBookingCard({ booking, onSubmitted }) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Server is the source of truth. The parent reloads the reviews data, so
      // this booking leaves the eligible list and the pending review appears
      // under "My Reviews". No optimistic state.
      await api("/reviews", {
        method: "POST",
        body: { bookingId: booking.id, rating, title, body },
      });
      onSubmitted(booking.service?.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-ink">{booking.service?.name || "Service"}</div>
          <div className="text-xs text-muted">{fmtDate(booking.date)}</div>
        </div>
      </div>
      {error && <div className="form-error mt-3">{error}</div>}
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label className="label">Rating</label>
          <RatingSelector value={rating} onChange={setRating} />
        </div>
        <div>
          <label className="label" htmlFor={`review-title-${booking.id}`}>Title (optional)</label>
          <input
            id={`review-title-${booking.id}`}
            className="input"
            maxLength={120}
            placeholder="e.g. Sparkling clean!"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">{title.length}/120</p>
        </div>
        <div>
          <label className="label" htmlFor={`review-body-${booking.id}`}>Your review</label>
          <textarea
            id={`review-body-${booking.id}`}
            className="textarea"
            required
            minLength={4}
            maxLength={2000}
            rows={4}
            placeholder="Tell us how the cleaning went (4–2000 characters)."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">{body.length}/2000</p>
        </div>
        <button className="btn btn-primary w-full sm:w-auto" disabled={busy || rating < 1}>
          {busy ? "Submitting…" : "Submit review"}
        </button>
      </form>
    </div>
  );
}

// A single customer review as returned by GET /reviews/mine.
function ReviewCard({ review }) {
  return (
    <div className="card p-5 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{review.service?.name || "Service"}</div>
          <div className="text-xs text-muted">{fmtDate(review.createdAt)}</div>
        </div>
        <ReviewStatus status={review.status} />
      </div>
      <div className="mt-3">
        <Stars value={review.rating} />
      </div>
      {review.title && (
        <h3 className="mt-2 font-bold text-ink">{review.title}</h3>
      )}
      <p className="mt-1 text-sm leading-relaxed text-slate-700">{review.body}</p>
      {reviewStatusNotes[review.status] && (
        <p className="mt-3 text-xs text-muted">{reviewStatusNotes[review.status]}</p>
      )}
    </div>
  );
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [mine, booked] = await Promise.all([api("/reviews/mine"), api("/bookings")]);
      setReviews(mine.reviews);
      setBookings(booked.bookings);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const reviewedBookingIds = new Set(reviews.map((r) => r.bookingId));
  const eligible = bookings.filter(
    (b) => b.status === "worked" && !b.archivedAt && !reviewedBookingIds.has(b.id)
  );

  // After a successful POST /reviews, re-fetch from the server (the source of
  // truth): the booking leaves the eligible list and the new review appears
  // as "pending". No optimistic state.
  const onSubmitted = (name) => {
    setBanner({
      kind: "ok",
      text: `Review for ${name || "your cleaning"} submitted — thank you! It's now awaiting approval.`,
    });
    load();
  };

  return (
    <Shell links={links} sections={["Customer Portal"]} title="My Reviews"
      subtitle="Share feedback about your completed cleanings.">
      {banner?.kind === "ok" && <div className="form-ok mb-6">{banner.text}</div>}
      {error && <div className="form-error mb-6">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading reviews…</div>
      ) : (
        <>
          {eligible.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-bold text-ink">Leave a review</h2>
              <p className="mt-1 mb-4 text-sm text-muted">
                Share feedback about a completed cleaning. Reviews are moderated
                before they appear publicly.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                {eligible.map((b) => (
                  <EligibleBookingCard key={b.id} booking={b} onSubmitted={onSubmitted} />
                ))}
              </div>
            </div>
          )}

          {reviews.length > 0 ? (
            <div>
              {eligible.length === 0 && (
                <p className="mb-4 text-sm text-muted">
                  No completed cleanings are waiting for a review right now.
                </p>
              )}
              <h2 className="text-lg font-bold text-ink">My Reviews</h2>
              <p className="mt-1 mb-4 text-sm text-muted">
                Your reviews and their current moderation status.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {reviews.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            </div>
          ) : (
            eligible.length === 0 && (
              <div className="card empty-state">
                <Star size={36} className="mx-auto text-slate-300" />
                <p className="mt-3 font-semibold text-ink">No reviews yet.</p>
                <p className="text-sm">
                  Once a cleaning is completed, you can share your feedback here.
                </p>
                <Link href="/dashboard/bookings" className="btn btn-primary mt-4">
                  <CalendarCheck2 size={16} /> View my bookings
                </Link>
              </div>
            )
          )}
        </>
      )}
    </Shell>
  );
}