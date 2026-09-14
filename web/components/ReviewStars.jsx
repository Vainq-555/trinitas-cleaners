import { Star } from "lucide-react";

// Presentational 1–5 star rating. No state, no API, no mutations.
export default function ReviewStars({ rating, size = 15 }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
      ))}
    </span>
  );
}