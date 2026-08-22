"use client";

import Link from "next/link";
import { useState } from "react";
import { UserPlus, Sparkles, Mail, LockKeyhole, Phone, MapPin, UserRound } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SignupPage() {
  const { refresh } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/register", { method: "POST", body: form });
      await refresh();
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (label, icon, extra) => (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">{icon}</span>
        {extra}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 grid place-items-center px-4 py-12">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-lift">
              <Sparkles size={26} />
            </span>
            <h1 className="mt-4 page-title">Create your account</h1>
            <p className="mt-2 text-muted text-sm">
              Book window &amp; screen cleaning online and track everything in one place.
            </p>
          </div>

          <div className="card p-7 shadow-lift">
            {error && <div className="form-error">{error}</div>}
            <form onSubmit={submit} className="space-y-4">
              {field("Full name", <UserRound size={16} />,
                <input className="input !pl-10" required value={form.name} onChange={set("name")} placeholder="Jordan Sample" />)}
              {field("Email address", <Mail size={16} />,
                <input className="input !pl-10" type="email" required value={form.email} onChange={set("email")} placeholder="you@example.com" />)}
              <div className="grid sm:grid-cols-2 gap-4">
                {field("Phone", <Phone size={16} />,
                  <input className="input !pl-10" value={form.phone} onChange={set("phone")} placeholder="612-555-0100" />)}
                {field("Address", <MapPin size={16} />,
                  <input className="input !pl-10" value={form.address} onChange={set("address")} placeholder="Anoka, MN 55303" />)}
              </div>
              {field("Password (8+ characters)", <LockKeyhole size={16} />,
                <input className="input !pl-10" type="password" required minLength={8} value={form.password}
                  onChange={set("password")} placeholder="••••••••" />)}
              <button className="btn btn-primary w-full !py-3" disabled={busy}>
                <UserPlus size={16} /> {busy ? "Creating account…" : "Sign up"}
              </button>
              <p className="text-xs text-muted text-center">
                By signing up you agree to our service terms. We never share your data.
              </p>
            </form>
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-brand hover:underline">Log in</Link>
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}