import { Clock, CheckCircle2, XCircle, Hammer } from "lucide-react";

// Booking status tones (unchanged) plus additive monthly-subscription tones.
// The subscription statuses share the palette so both stay consistent:
// BLUE/green accepted/active, AMBER past due, RED canceled, NEUTRAL completed.
const styles = {
  pending: "bg-warnbg text-amber-700 border border-amber-200",
  accepted: "bg-okbg text-clean-dark border border-green-200",
  worked: "bg-brand-light text-brand-dark border border-brand-soft",
  declined: "bg-dangerbg text-danger border border-red-200",
  // Monthly subscription statuses (backend Subscription.status values).
  active: "bg-green-100 text-green-800 border border-green-300",
  past_due: "bg-warnbg text-amber-700 border border-amber-300",
  canceled: "bg-dangerbg text-danger border border-red-200",
  completed: "bg-slate-100 text-slate-600 border border-slate-200",
};

const icons = {
  pending: Clock,
  accepted: CheckCircle2,
  worked: Hammer,
  declined: XCircle,
  // Additive subscription icons.
  active: CheckCircle2,
  past_due: Clock,
  canceled: XCircle,
  completed: CheckCircle2,
};

// Color-coded status badge (YELLOW pending, GREEN accepted/worked/active,
// RED declined/canceled, NEUTRAL completed).
export default function StatusBadge({ status }) {
  const Icon = icons[status] || Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${styles[status] || "bg-slate-100 text-slate-600"}`}>
      <Icon size={12} />
      {status}
    </span>
  );
}