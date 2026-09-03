"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, Sparkles, LockKeyhole, ShieldCheck, AlertTriangle } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { api } from "@/lib/api";
import { readResetToken, validateResetInput, classifyResetApiError } from "@/lib/passwordRecovery.mjs";

function ResetForm() {
  const params = useSearchParams();
  const token = readResetToken(params);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  // Preserve the token only for the single submission; never store it in
  // localStorage/sessionStorage/persistent state.
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    if (!token) {
      setExpired(true);
      setBusy(false);
      return;
    }
    const validation = validateResetInput({ password, confirm });
    if (validation) {
      setError(validation);
      setBusy(false);
      return;
    }
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password, confirm } });
      setDone(true);
    } catch (err) {
      if (classifyResetApiError(err?.status) === "expired") setExpired(true);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (expired) {
    return (
      <div className="card p-7 shadow-lift text-center space-y-4">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-amber-600">
          <AlertTriangle size={26} />
        </div>
        <div>
          <h2 className="page-title !text-xl">Link invalid or expired</h2>
          <p className="mt-2 text-sm text-muted">
            This password reset link is invalid, has already been used, or has expired. Request a new one.
          </p>
        </div>
        <Link href="/forgot-password" className="btn btn-primary w-full">Request a new link</Link>
        <p>
          <Link href="/login" className="text-sm font-semibold text-brand hover:underline">Back to login</Link>
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card p-7 shadow-lift text-center space-y-4">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-green-100 text-green-600">
          <ShieldCheck size={26} />
        </div>
        <div>
          <h2 className="page-title !text-xl">Password updated</h2>
          <p className="mt-2 text-sm text-muted">Your password has been reset. You can now log in with your new password.</p>
        </div>
        <Link href="/login" className="btn btn-primary w-full">Back to login</Link>
      </div>
    );
  }

  return (
    <>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">New password</label>
          <div className="relative">
            <LockKeyhole size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-10" type="password" required minLength={8} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
        </div>
        <div>
          <label className="label">Confirm password</label>
          <div className="relative">
            <LockKeyhole size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-10" type="password" required minLength={8} autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
          </div>
        </div>
        <button className="btn btn-primary w-full !py-3" disabled={busy}>
          {busy ? "Updating…" : "Set new password"}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 grid place-items-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-lift">
              <Sparkles size={26} />
            </span>
            <h1 className="mt-4 page-title">Choose a new password</h1>
            <p className="mt-2 text-muted text-sm">Enter a new password for your account.</p>
          </div>
          <Suspense fallback={<div className="card p-7 shadow-lift text-center text-muted text-sm">Loading…</div>}>
            <ResetForm />
          </Suspense>
          <p className="mt-6 text-center text-sm text-muted">
            <Link href="/login" className="font-semibold text-brand hover:underline">Back to login</Link>
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}