"use client";

// Employee account ACTIVATION — the destination of the admin-issued invitation
// email. Deliberately minimal: it sets the invitee's first password and nothing
// else. The admin never sets, sees or receives this password.
//
// The token is read from the URL and used for the single submission only. It is
// never written to localStorage/sessionStorage, and it is not displayed.

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, Sparkles, LockKeyhole, ShieldCheck, AlertTriangle } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { api } from "@/lib/api";

function readToken(params) {
  const raw = params?.get("token");
  if (typeof raw !== "string") return "";
  return raw.trim();
}

function ActivationForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");

    const token = readToken(params);
    if (!token) {
      setInvalid(true);
      setBusy(false);
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      setBusy(false);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      setBusy(false);
      return;
    }

    try {
      await api("/auth/employee-activation", { method: "POST", body: { token, password, confirm } });
      setDone(true);
    } catch (err) {
      // The API returns one identical message for every invalid, expired,
      // already-used or wrong-account case, so nothing is disclosed here.
      if (err?.status === 400) setInvalid(true);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <div className="card p-7 shadow-lift text-center space-y-4">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-amber-600">
          <AlertTriangle size={26} />
        </div>
        <div>
          <h2 className="page-title !text-xl">Invitation invalid or expired</h2>
          <p className="mt-2 text-sm text-muted">
            This invitation link is invalid, has already been used, or has expired.
            Ask your administrator to send a new one.
          </p>
        </div>
        <Link href="/login" className="btn btn-primary w-full">Back to login</Link>
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
          <h2 className="page-title !text-xl">Account activated</h2>
          <p className="mt-2 text-sm text-muted">
            Your password has been set. You can now log in to your employee account.
          </p>
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
          <label className="label">Choose a password</label>
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
          <KeyRound size={16} /> {busy ? "Activating…" : "Activate my account"}
        </button>
      </form>
    </>
  );
}

export default function ActivateEmployeePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 grid place-items-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-lift">
              <Sparkles size={26} />
            </span>
            <h1 className="mt-4 page-title">Activate your account</h1>
            <p className="mt-2 text-muted text-sm">Choose a password for your new employee account.</p>
          </div>

          <div className="card p-7 shadow-lift">
            <Suspense fallback={<div className="text-center text-muted text-sm">Loading…</div>}>
              <ActivationForm />
            </Suspense>
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
