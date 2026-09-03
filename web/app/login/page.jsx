"use client";

import Link from "next/link";
import { useState } from "react";
import { LogIn, Sparkles, LockKeyhole, Mail } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/auth/login", { method: "POST", body: { email, password } });
      await refresh();
      window.location.href = data.user.role === "admin" ? "/admin" : "/dashboard";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 grid place-items-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-lift">
              <Sparkles size={26} />
            </span>
            <h1 className="mt-4 page-title">Welcome back</h1>
            <p className="mt-2 text-muted text-sm">Log in to your Trinitas-Cleaners account.</p>
          </div>

          <div className="card p-7 shadow-lift">
            {error && <div className="form-error">{error}</div>}
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="input !pl-10" type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <LockKeyhole size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="input !pl-10" type="password" required value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div className="mt-2 text-right text-sm">
                  <Link href="/forgot-password" className="font-semibold text-brand hover:underline">Forgot password?</Link>
                </div>
              </div>
              <button className="btn btn-primary w-full !py-3" disabled={busy}>
                <LogIn size={16} /> {busy ? "Logging in…" : "Log in"}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            No account yet?{" "}
            <Link href="/signup" className="font-semibold text-brand hover:underline">Sign up free</Link>
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}