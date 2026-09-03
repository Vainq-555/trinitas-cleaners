"use client";

import Link from "next/link";
import { useState } from "react";
import { KeyRound, Sparkles, Mail, ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email } });
      setDone(true);
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
              <KeyRound size={26} />
            </span>
            <h1 className="mt-4 page-title">Reset your password</h1>
            <p className="mt-2 text-muted text-sm">
              Enter your account email and we&apos;ll send you a reset link.
            </p>
          </div>

          <div className="card p-7 shadow-lift">
            {done ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted">
                  If an account exists for that email, a password reset link has been sent.
                  Check your inbox (and your spam folder).
                </p>
                <Link href="/login" className="btn btn-primary w-full">
                  <ArrowLeft size={16} /> Back to login
                </Link>
              </div>
            ) : (
              <>
                {error && <div className="form-error">{error}</div>}
                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <label className="label">Email address</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                      <input className="input !pl-10" type="email" required autoComplete="email" value={email}
                        onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                    </div>
                  </div>
                  <button className="btn btn-primary w-full !py-3" disabled={busy}>
                    {busy ? "Sending…" : "Send reset link"}
                  </button>
                </form>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            <Link href="/login" className="font-semibold text-brand hover:underline">Back to login</Link>
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}