import { Clock, CheckCircle2, XCircle, Hammer } from "lucide-react";

const styles = {
  pending: "bg-warnbg text-amber-700 border border-amber-200",
  accepted: "bg-okbg text-clean-dark border border-green-200",
  worked: "bg-brand-light text-brand-dark border border-brand-soft",
  declined: "bg-dangerbg text-danger border border-red-200",
};

const icons = {
  pending: Clock,
  accepted: CheckCircle2,
  worked: Hammer,
  declined: XCircle,
};

// Color-coded booking status badge (YELLOW pending, GREEN accepted/worked, RED declined).
export default function StatusBadge({ status }) {
  const Icon = icons[status] || Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${styles[status] || "bg-slate-100 text-slate-600"}`}>
      <Icon size={12} />
      {status}
    </span>
  );
}