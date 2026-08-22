// Admin dashboard metric card.
export default function StatCard({ icon: Icon, label, value, accent = "text-brand", bg = "bg-brand-light" }) {
  return (
    <div className="card p-5 flex items-start justify-between transition-all duration-200 hover:shadow-lift">
      <div>
        <div className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">{value}</div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      </div>
      <span className={`grid h-11 w-11 place-items-center rounded-xl ${bg} ${accent}`}>
        {Icon && <Icon size={20} />}
      </span>
    </div>
  );
}