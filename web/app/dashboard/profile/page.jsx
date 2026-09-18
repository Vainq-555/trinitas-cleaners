"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings, Star,
  Users, Save, RefreshCw, UserRound, Wifi, Eye, ExternalLink,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";
import {
  PROFILE_BIO_MAX,
  PROFILE_CITY_MAX,
  PROFILE_DISPLAY_NAME_MAX,
  normalizeAvatarUrl,
  normalizeBio,
  normalizeCity,
  normalizeDisplayName,
  normalizeState,
  toOwnPayload,
} from "@/lib/profile";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/reviews", label: "My Reviews", icon: Star },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const emptyForm = {
  displayName: "",
  bio: "",
  avatarUrl: "",
  locationCity: "",
  locationState: "",
  showOnline: true,
  profileVisible: true,
};

export default function OwnProfilePage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [fieldErr, setFieldErr] = useState("");
  const [userId, setUserId] = useState(null);
  const [moderationHiddenAt, setModerationHiddenAt] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErr("");
    setSaveErr("");
    setSaveMsg("");
  };

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api("/profile");
      const p = data?.profile;
      if (!p) throw new Error("Your profile couldn't be loaded.");
      setUserId(p.userId);
      setModerationHiddenAt(p.moderationHiddenAt ?? null);
      setForm({
        displayName: p.displayName ?? "",
        bio: p.bio ?? "",
        avatarUrl: p.avatarUrl ?? "",
        locationCity: p.locationCity ?? "",
        locationState: p.locationState ?? "",
        showOnline: p.showOnline ?? true,
        profileVisible: p.profileVisible ?? true,
      });
    } catch (err) {
      setLoadError(err.message || "Couldn't load your profile. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (saving) return;

    const checks = [
      ["displayName", normalizeDisplayName(form.displayName)],
      ["bio", normalizeBio(form.bio)],
      ["avatarUrl", normalizeAvatarUrl(form.avatarUrl)],
      ["locationCity", normalizeCity(form.locationCity)],
      ["locationState", normalizeState(form.locationState)],
    ];
    for (const [key, out] of checks) {
      if (out.error) {
        setFieldErr(out.error);
        return;
      }
    }

    setSaving(true);
    setSaveMsg("");
    setSaveErr("");
    try {
      const payload = toOwnPayload({
        ...form,
        avatarUrl: normalizeAvatarUrl(form.avatarUrl).value ?? null,
        bio: form.bio.trim() === "" ? null : form.bio.trim(),
        locationCity: form.locationCity.trim() === "" ? null : form.locationCity.trim(),
        locationState: form.locationState.trim() === "" ? null : form.locationState.trim(),
      });
      const data = await api("/profile", { method: "PUT", body: payload });
      const p = data?.profile;
      if (p) {
        setUserId(p.userId);
        setModerationHiddenAt(p.moderationHiddenAt ?? null);
        setForm({
          displayName: p.displayName ?? "",
          bio: p.bio ?? "",
          avatarUrl: p.avatarUrl ?? "",
          locationCity: p.locationCity ?? "",
          locationState: p.locationState ?? "",
          showOnline: p.showOnline ?? true,
          profileVisible: p.profileVisible ?? true,
        });
      }
      setSaveMsg("Your profile has been saved.");
    } catch (err) {
      setSaveErr(err.message || "Couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const avatarPreview = normalizeAvatarUrl(form.avatarUrl).value ?? null;

  return (
    <Shell links={links} sections={["Customer Portal", "Community"]} title="Your Profile"
      subtitle="This is how other customers see you in the Community.">
      {loading ? (
        <div className="empty-state">Loading your profile…</div>
      ) : loadError ? (
        <div className="empty-state">
          <p className="font-semibold text-ink">Couldn't load your profile.</p>
          <p className="text-sm">{loadError}</p>
          <button className="btn btn-outline mt-3" onClick={load}>
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      ) : (
        <div className="card p-5 sm:p-6">
          {moderationHiddenAt && (
            <div role="status" className="mb-5 border border-amber-200 bg-warnbg px-4 py-3 text-sm text-amber-700">
              This profile is currently hidden from other customers. You can still
              edit it below; it becomes visible again once a moderator unhides it.
            </div>
          )}

          {userId && (
            <p className="mb-5 text-sm text-muted">
              <Link href={`/dashboard/profile/${userId}`} className="inline-flex items-center gap-1.5 text-clean font-semibold hover:underline">
                <ExternalLink size={14} /> View your public profile
              </Link>
            </p>
          )}

          <form onSubmit={save} className="space-y-5">
            {/* Avatar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-clean-light text-clean">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <UserRound size={26} />
                )}
              </div>
              <div className="flex-1">
                <label htmlFor="avatarUrl" className="form-label block">Avatar URL (https)</label>
                <input
                  id="avatarUrl"
                  className="input w-full"
                  placeholder="https://example.com/avatar.jpg"
                  value={form.avatarUrl}
                  maxLength={500}
                  onChange={(e) => setField("avatarUrl", e.target.value)}
                />
                <p className="mt-1 text-xs text-muted">Only secure https links are accepted. Uploads aren't available yet.</p>
              </div>
            </div>

            {/* Display name */}
            <div>
              <label htmlFor="displayName" className="form-label block">Display name</label>
              <input
                id="displayName"
                className="input w-full"
                value={form.displayName}
                maxLength={PROFILE_DISPLAY_NAME_MAX}
                onChange={(e) => setField("displayName", e.target.value)}
              />
              <p className="mt-1 text-right text-xs text-muted">{form.displayName.length}/{PROFILE_DISPLAY_NAME_MAX}</p>
            </div>

            {/* Bio */}
            <div>
              <label htmlFor="bio" className="form-label block">Bio</label>
              <textarea
                id="bio"
                className="textarea w-full"
                rows={3}
                maxLength={PROFILE_BIO_MAX}
                placeholder="Tell the community a little about yourself…"
                value={form.bio}
                onChange={(e) => setField("bio", e.target.value)}
              />
              <p className="mt-1 text-right text-xs text-muted">{form.bio.length}/{PROFILE_BIO_MAX}</p>
            </div>

            {/* Location */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="locationCity" className="form-label block">City</label>
                <input
                  id="locationCity"
                  className="input w-full"
                  placeholder="Minneapolis"
                  value={form.locationCity}
                  maxLength={PROFILE_CITY_MAX}
                  onChange={(e) => setField("locationCity", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="locationState" className="form-label block">State</label>
                <input
                  id="locationState"
                  className="input w-full"
                  placeholder="MN"
                  maxLength={2}
                  value={form.locationState}
                  onChange={(e) => setField("locationState", e.target.value)}
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="input !w-auto !p-2"
                  checked={form.showOnline}
                  onChange={(e) => setField("showOnline", e.target.checked)}
                />
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Wifi size={15} /> Show when I'm online
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="input !w-auto !p-2"
                  checked={form.profileVisible}
                  onChange={(e) => setField("profileVisible", e.target.checked)}
                />
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Eye size={15} /> Let other customers view my profile
                </span>
              </label>
            </div>

            {/* Status + submit */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button className="btn btn-primary w-full sm:w-auto" disabled={saving}>
                <Save size={16} /> {saving ? "Saving…" : "Save profile"}
              </button>
              <div className="text-right" aria-live="polite">
                {saveMsg && <p className="form-ok mb-1">{saveMsg}</p>}
                {saveErr && !fieldErr && <p className="form-error mb-1">{saveErr}</p>}
                {fieldErr && <p className="form-error mb-1">{fieldErr}</p>}
              </div>
            </div>
          </form>
        </div>
      )}
    </Shell>
  );
}