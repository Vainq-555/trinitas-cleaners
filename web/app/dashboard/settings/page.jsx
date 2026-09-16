"use client";

import { useEffect, useState } from "react";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  Star, Save, Trash2, ShieldAlert, UserRound, Mail, Phone, MapPin, LogOut,
  Sun, Moon, Monitor,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAppearance } from "@/lib/appearance";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/reviews", label: "My Reviews", icon: Star },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const { mode: appearance, setAppearance } = useAppearance();
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const appearanceOptions = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  useEffect(() => {
    if (user) setForm({ name: user.name, phone: user.phone || "", address: user.address || "" });
  }, [user]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api("/auth/profile", { method: "PUT", body: form });
      await refresh();
      setMsg("Profile updated.");
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!confirm("Permanently delete your account and all bookings/receipts? This cannot be undone.")) return;
    try {
      await api("/auth/account", { method: "DELETE" });
      window.location.href = "/";
    } catch (x) {
      alert(x.message);
    }
  };

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Settings"
      subtitle="Manage your profile and account.">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Profile */}
        <div className="card card-pad">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><UserRound size={18} /></span>
            <h2 className="font-bold text-ink">Profile</h2>
          </div>
          {err && <div className="form-error mt-4">{err}</div>}
          {msg && <div className="form-ok mt-4">{msg}</div>}
          <form onSubmit={save} className="mt-5 space-y-4">
            <div>
              <label className="label">Full name</label>
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label"><Phone size={12} className="inline -mt-0.5 mr-1" />Phone</label>
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="label"><MapPin size={12} className="inline -mt-0.5 mr-1" />Address</label>
                <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label"><Mail size={12} className="inline -mt-0.5 mr-1" />Email (login)</label>
              <input className="input bg-slate-50 text-muted dark:bg-slate-900 dark:text-slate-400" value={user?.email || ""} disabled />
              <p className="mt-1.5 text-xs text-muted">Email can't be changed; contact the admin if needed.</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn btn-primary" disabled={busy}>
                <Save size={16} /> {busy ? "Saving…" : "Save changes"}
              </button>
              <button type="button" className="btn btn-outline" onClick={handleLogout}>
                <LogOut size={16} /> Log out
              </button>
            </div>
          </form>
        </div>

        {/* Appearance */}
        <div className="card card-pad">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><Monitor size={18} /></span>
            <h2 className="font-bold text-ink">Appearance</h2>
          </div>
          <p className="mt-4 text-sm text-muted leading-relaxed">Choose how Trinitas looks on this device.</p>
          <div className="mt-4 grid sm:grid-cols-3 gap-2">
            {appearanceOptions.map(({ value, label, icon: Icon }) => {
              const active = appearance === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAppearance(value)}
                  className={active ? "tab-btn tab-btn-active" : "tab-btn"}
                >
                  <Icon size={15} className="inline -mt-0.5 mr-1.5" />
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">System follows your device. Admin stays light.</p>
        </div>

        {/* Danger zone */}
        <div className="card card-pad border-red-200">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-dangerbg text-danger"><ShieldAlert size={18} /></span>
            <h2 className="font-bold text-danger">Danger zone</h2>
          </div>
          <p className="mt-4 text-sm text-muted leading-relaxed">
            Permanently removes your account, bookings, receipts, and messages. This
            action cannot be undone.
          </p>
          <button className="btn btn-danger mt-5" onClick={deleteAccount}>
            <Trash2 size={16} /> Delete my account
          </button>
        </div>
      </div>
    </Shell>
  );
}