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
import { useMyLocation } from "@/lib/geo";

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
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState("");
  const [address, setAddress] = useState({ line1: "", city: "", state: "", postalCode: "", country: "US" });
  const [promoCode, setPromoCode] = useState("");

  useEffect(() => {
    api("/services").then((d) => setServices(d.services)).catch(() => {});
  }, []);

  const useLocation = async () => {
    if (locating) return;
    setLocating(true);
    setLocNote("");
    try {
      const result = await useMyLocation({ geolocation: typeof navigator !== "undefined" ? navigator.geolocation : null, fetchImpl: (path) => api(path) });
      if (result?.ok && result.address) {
        setAddress({ country: "US", ...result.address });
        setLocNote("Address filled from your current location — please review and confirm your address before booking.");
      } else if (result?.address) {
        setAddress({ country: "US", ...address, ...result.address });
        setLocNote(result?.message || "Please review and correct your address manually.");
      } else {
        setLocNote(result?.message || "Unable to determine your address automatically. Please enter your address manually.");
      }
    } catch {
      setLocNote("Unable to determine your address automatically. Please enter your address manually.");
    } finally {
      setLocating(false);
    }
  };

  const book = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api("/bookings", { method: "POST", body: { serviceId: selected.id, date, note, paymentMethod, promoCode: promoCode.trim() || undefined, serviceAddress: address } });
      setOk(paymentMethod === "online"
        ? "Booking submitted. Your booking is awaiting approval. You'll be able to pay once it is approved."
        : "Booking requested! We'll confirm shortly.");
      setSelected(null);
      setDate("");
      setNote("");
      setPaymentMethod("cash");
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
                <label className="label">Service address (used for sales tax)</label>
                <div className="space-y-2">
                  <input className="input" required placeholder="Street address" value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} />
                  <div className="grid grid-cols-2 gap-2"><input className="input" required placeholder="City" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} /><input className="input" required placeholder="State" maxLength="2" value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} /></div>
                  <input className="input" required placeholder="ZIP code" value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} />
                  <button type="button" className="btn btn-outline btn-sm" onClick={useLocation} disabled={locating}>
                    {locating ? "Finding your location…" : "📍 Use my current location"}
                  </button>
                  {locNote && (
                    <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900" role="alert">
                      {locNote}
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">Tax is calculated by Stripe for this location. No estimated rate is used.</p>
              </div>
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
              <div>
                <label className="label">Promotion code (optional)</label>
                <input className="input" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="Enter a code" />
              </div>
              <div>
                <label className="label">Payment method</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={`cursor-pointer rounded-xl border px-4 py-3 ${paymentMethod === "online" ? "border-brand bg-brand-light" : "border-line"}`}>
                    <input className="mr-2" type="radio" name="paymentMethod" value="online" checked={paymentMethod === "online"} onChange={(e) => setPaymentMethod(e.target.value)} />
                    <span className="font-semibold text-ink">Pay online</span>
                    <span className="block pl-6 text-xs text-muted">Secure Stripe Checkout after approval</span>
                  </label>
                  <label className={`cursor-pointer rounded-xl border px-4 py-3 ${paymentMethod === "cash" ? "border-brand bg-brand-light" : "border-line"}`}>
                    <input className="mr-2" type="radio" name="paymentMethod" value="cash" checked={paymentMethod === "cash"} onChange={(e) => setPaymentMethod(e.target.value)} />
                    <span className="font-semibold text-ink">Pay with cash</span>
                    <span className="block pl-6 text-xs text-muted">Pay after service</span>
                  </label>
                </div>
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
