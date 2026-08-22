"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  ArrowLeft, CalendarPlus, BadgePercent,
} from "lucide-react";
import Shell from "@/components/Shell";
import ServiceCard from "@/components/ServiceCard";
import { api, money } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function ServicesPage() {
  const router = useRouter();
  const [services, setServices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/services").then((d) => setServices(d.services)).catch(() => {});
  }, []);

  const book = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api("/bookings", { method: "POST", body: { serviceId: selected.id, date, note } });
      setOk("Booking requested! We'll confirm shortly.");
      setSelected(null);
      setDate("");
      setNote("");
      setTimeout(() => router.push("/dashboard/bookings"), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Book a Service"
      subtitle="Choose a service, pick a date, and we'll confirm your booking.">
      {error && <div className="form-error">{error}</div>}
      {ok && <div className="form-ok">{ok}</div>}

      {!selected ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              price={s.price}
              action={
                <button className="btn btn-primary btn-sm" onClick={() => setSelected(s)}>
                  <CalendarPlus size={14} /> Book now
                </button>
              }
            />
          ))}
        </div>
      ) : (
        <div className="max-w-lg">
          <button className="btn btn-ghost btn-sm mb-4" onClick={() => setSelected(null)}>
            <ArrowLeft size={15} /> Back to services
          </button>
          <div className="card card-pad">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-ink">{selected.name}</h2>
                <p className="mt-1 text-sm text-muted">{selected.description}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-light px-4 py-3">
              <div>
                <span className="block text-[11px] uppercase tracking-wide font-semibold text-brand">Price</span>
                <span className="text-2xl font-extrabold text-brand-dark">{money(selected.price)}</span>
              </div>
              {selected.price !== selected.basePrice ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-clean text-white px-3 py-1 text-xs font-bold">
                  <BadgePercent size={13} /> Personalized rate
                </span>
              ) : (
                <span className="text-xs text-muted">Flat rate · no hidden fees</span>
              )}
            </div>

            <form onSubmit={book} className="mt-5 space-y-4">
              <div>
                <label className="label">Preferred date</label>
                <input className="input" type="date" required value={date}
                  min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Notes for the crew (optional)</label>
                <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. 12 windows, two stories, back door access" />
              </div>
              <button className="btn btn-primary w-full !py-3" disabled={busy}>
                {busy ? "Requesting…" : "Request booking"}
              </button>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}