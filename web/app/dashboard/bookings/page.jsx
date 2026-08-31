"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  Trash2, CalendarPlus,
} from "lucide-react";
import Shell from "@/components/Shell";
import StatusBadge from "@/components/StatusBadge";
import { api, fmtDate, money, moneyCents } from "@/lib/api";
import { useMyLocation } from "@/lib/geo";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const filters = ["all", "pending", "accepted", "worked", "declined"];

export default function BookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [paying, setPaying] = useState(null);
  const [quote, setQuote] = useState(null);
  const [addressRequired, setAddressRequired] = useState(false);
  const [addressBookingId, setAddressBookingId] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState("");
  const [serviceAddress, setServiceAddress] = useState({ line1: "", city: "", state: "", postalCode: "", country: "US" });

  const load = () =>
    api("/bookings").then((d) => setBookings(d.bookings)).finally(() => setLoading(false));

  useEffect(() => {
    load();
    // Stripe Checkout redirect feedback. URL parameters are display-only;
    // the server's webhook remains the sole authority on payment status.
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("payment");
    if (outcome) {
      const bookingId = params.get("booking_id");
      if (outcome === "success") {
        setBanner({
          kind: "ok",
          text: bookingId
            ? `Payment received for booking #${bookingId.slice(0, 6).toUpperCase()}. If the status still shows pending, it will update in a few seconds.`
            : "Payment received. Thank you!",
        });
        // Give the webhook a moment to land, then refresh the list once.
        setTimeout(() => api("/bookings").then((d) => setBookings(d.bookings)).catch(() => {}), 2500);
      } else {
        setBanner({
          kind: "error",
          text: "Checkout was not completed. Your booking is saved — you can pay anytime with “Pay now”.",
        });
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const requestQuote = async (id, address) => {
    setPaying(id);
    try {
      const preview = await api(`/bookings/${id}/checkout`, { method: "POST", body: address ? { serviceAddress: address } : undefined });
      setQuote({ bookingId: id, serviceAddress: address, ...preview.quote });
      setAddressRequired(false);
      setAddressBookingId(null);
      setPaying(null);
    } catch (e) {
      if (e.data?.requiresAddress) {
        setAddressRequired(true);
        setAddressBookingId(id);
      }
      else alert(e.message);
      setPaying(null);
    }
  };

  const pay = (id) => requestQuote(id);

  const submitAddress = (event) => {
    event.preventDefault();
    const id = addressBookingId;
    if (id) requestQuote(id, serviceAddress);
  };

  const useLocation = async () => {
    if (locating) return;
    setLocating(true);
    setLocNote("");
    try {
      const result = await useMyLocation({ geolocation: typeof navigator !== "undefined" ? navigator.geolocation : null });
      if (result?.ok && result.address) {
        setServiceAddress({ country: "US", ...result.address });
        setLocNote("Address filled from your current location — please review and edit before continuing.");
      } else if (result?.address) {
        setServiceAddress({ country: "US", ...serviceAddress, ...result.address });
        setLocNote(result?.message || "Please review and correct the address.");
      } else {
        setLocNote(result?.message || "We couldn't use your current location. Please enter your address manually.");
      }
    } catch {
      setLocNote("We couldn't use your current location. Please enter your address manually.");
    } finally {
      setLocating(false);
    }
  };

  const approveQuote = async () => {
    if (!quote) return;
    setPaying(quote.bookingId);
    try {
      const { url } = await api(`/bookings/${quote.bookingId}/checkout`, {
        method: "POST",
        body: { confirm: true, approvedFinalAmountCents: quote.finalAmountCents, serviceAddress: quote.serviceAddress },
      });
      window.location.assign(url);
    } catch (e) {
      alert(e.message);
      setPaying(null);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this booking? This cannot be undone.")) return;
    try {
      await api(`/bookings/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const shown = filter === "all" ? bookings : bookings.filter((b) => b.status === filter);

  return (
    <Shell links={links} sections={["Customer Portal"]} title="My Bookings"
      subtitle="View history, track status, or cancel a pending booking.">
      {banner && <div className={banner.kind === "ok" ? "form-ok" : "form-error"}>{banner.text}</div>}
      {addressRequired && (
        <form className="card card-pad mb-6 max-w-lg border-2 border-brand" onSubmit={submitAddress}>
          <h2 className="text-lg font-bold text-ink">Confirm service address</h2>
          <p className="mt-1 text-sm text-muted">A complete service address is required to calculate the current tax before payment.</p>
          <div className="mt-4 space-y-2">
            <input className="input" required placeholder="Street address" value={serviceAddress.line1} onChange={(e) => setServiceAddress({ ...serviceAddress, line1: e.target.value })} />
            <div className="grid grid-cols-2 gap-2"><input className="input" required placeholder="City" value={serviceAddress.city} onChange={(e) => setServiceAddress({ ...serviceAddress, city: e.target.value })} /><input className="input" required placeholder="State" maxLength="2" value={serviceAddress.state} onChange={(e) => setServiceAddress({ ...serviceAddress, state: e.target.value })} /></div>
            <input className="input" required placeholder="ZIP code" value={serviceAddress.postalCode} onChange={(e) => setServiceAddress({ ...serviceAddress, postalCode: e.target.value })} />
            <button type="button" className="btn btn-outline btn-sm" onClick={useLocation} disabled={locating}>
              {locating ? "Finding your location…" : "📍 Use my current location"}
            </button>
            {locNote && <p className="text-xs text-muted" role="status">{locNote}</p>}
          </div>
          <button className="btn btn-primary mt-4" disabled={!addressBookingId || paying !== null}>Calculate tax and review total</button>
        </form>
      )}
      {quote && (
        <div className="card card-pad mb-6 max-w-lg border-2 border-brand">
          <h2 className="text-lg font-bold text-ink">Confirm payment amount</h2>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><span>Service price</span><span>{moneyCents(quote.basePriceCents)}</span></div>
            <div className="flex justify-between text-clean"><span>Discount</span><span>− {moneyCents(quote.discountCents)}</span></div>
            <div className="flex justify-between border-t border-line pt-2"><span>Taxable subtotal</span><span>{moneyCents(quote.taxableSubtotalCents)}</span></div>
            <div className="flex justify-between"><span>Sales tax</span><span>{moneyCents(quote.taxCents)}</span></div>
            <div className="flex justify-between border-t-2 border-ink pt-3 text-lg font-extrabold"><span>FINAL TOTAL</span><span>{moneyCents(quote.finalAmountCents)}</span></div>
          </div>
          <div className="mt-5 flex gap-2"><button className="btn btn-primary" disabled={paying === quote.bookingId} onClick={approveQuote}>{paying === quote.bookingId ? "Opening checkout…" : `Pay ${moneyCents(quote.finalAmountCents)}`}</button><button className="btn btn-outline" onClick={() => { setQuote(null); setPaying(null); }}>Cancel</button></div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-6">
        {filters.map((s) => (
          <button key={s} className={`tab-btn ${filter === s ? "tab-btn-active" : ""}`} onClick={() => setFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1.5 opacity-70">({bookings.filter((b) => (s === "all" ? true : b.status === s)).length})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">Loading bookings…</div>
      ) : shown.length === 0 ? (
        <div className="card empty-state">
          <p className="font-semibold text-ink">No {filter !== "all" ? filter : ""} bookings found.</p>
          <Link href="/dashboard/services" className="btn btn-primary mt-4">
            <CalendarPlus size={16} /> Book a service
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                  <tr>
                   <th>Service</th><th>Date</th><th>Status</th><th>Price</th><th>Payment</th><th>Note</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td className="font-semibold">{b.service.name}</td>
                    <td className="text-muted">{fmtDate(b.date)}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="font-semibold">{Number.isInteger(b.finalAmountCents) ? moneyCents(b.finalAmountCents) : money(b.price)}</td>
                    <td className="text-xs">
                      <div className="font-semibold capitalize">{b.payment?.method || "—"}</div>
                      <div className={b.payment?.status === "paid" ? "text-clean" : "text-muted"}>{b.payment?.status || "—"}</div>
                    </td>
                    <td className="text-muted text-xs max-w-[180px] truncate">{b.note || "—"}</td>
                    <td className="text-right">
                      {b.payment?.method === "online" && !["paid", "refunded"].includes(b.payment?.status) && (
                        <button className="btn btn-primary btn-sm mr-2" disabled={paying === b.id} onClick={() => pay(b.id)}>
                          <CalendarPlus size={14} /> {b.payment?.status === "pending" ? "Pay now" : "Retry payment"}
                        </button>
                      )}
                      {b.status === "pending" && (
                        <button className="btn btn-danger btn-sm" onClick={() => remove(b.id)}>
                          <Trash2 size={14} /> Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
