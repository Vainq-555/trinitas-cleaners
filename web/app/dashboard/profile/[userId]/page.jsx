"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings, Star,
  Users, RefreshCw, UserRound, Wifi, MapPin, ArrowLeft,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";
import { isValidAvatarUrl, onlineOf, toPublicShape } from "@/lib/profile";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/reviews", label: "My Reviews", icon: Star },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function PublicProfilePage() {
  const params = useParams();
  const userId = typeof params?.userId === "string" ? params.userId : "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState(null);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    setNotFound(false);
    if (!userId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const data = await api(`/profile/${encodeURIComponent(userId)}`);
      // Defense in depth: keep only the approved public keys.
      setProfile(toPublicShape(data?.profile));
      if (!data?.profile) setNotFound(true);
    } catch (err) {
      if (err.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(err.message || "Couldn't load this profile. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [userId]);

  const online = onlineOf(profile);
  const avatar = profile && isValidAvatarUrl(profile.avatarUrl) ? profile.avatarUrl : null;
  const location = [profile?.locationCity, profile?.locationState].filter(Boolean).join(", ");

  return (
    <Shell links={links} sections={["Customer Portal", "Community", "Profile"]} title="Profile"
      subtitle="A public Community profile.">
      {loading ? (
        <div className="empty-state">Loading profile…</div>
      ) : notFound ? (
        <div className="empty-state">
          <p className="font-semibold text-ink">This profile isn't available.</p>
          <p className="text-sm">It may be hidden, or the link may be wrong.</p>
          <Link href="/dashboard/community" className="btn btn-outline mt-3">
            <ArrowLeft size={15} /> Back to the Community
          </Link>
        </div>
      ) : loadError ? (
        <div className="empty-state">
          <p className="font-semibold text-ink">Couldn't load this profile.</p>
          <p className="text-sm">{loadError}</p>
          <button className="btn btn-outline mt-3" onClick={load}>
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      ) : (
        <div className="card p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-clean-light text-clean">
              {avatar ? (
                <img src={avatar} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <UserRound size={26} />
              )}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-xl font-bold text-ink">{profile?.displayName || "Community member"}</h1>
                {online !== null && (
                  <span
                    role="status"
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      online ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-muted"
                    }`}
                  >
                    <Wifi size={12} /> {online ? "Online" : "Offline"}
                  </span>
                )}
              </div>
              {location && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted">
                  <MapPin size={14} /> {location}
                </p>
              )}
              {profile?.bio ? (
                <p className="mt-3 text-sm whitespace-pre-wrap break-words text-ink">{profile.bio}</p>
              ) : (
                <p className="mt-3 text-sm text-muted">No bio yet.</p>
              )}
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3 border-t border-line pt-4">
            <Link href="/dashboard/community" className="btn btn-outline btn-sm">
              <Users size={15} /> Community
            </Link>
            <Link href="/dashboard/profile" className="btn btn-outline btn-sm">
              <UserRound size={15} /> Your profile
            </Link>
          </div>
        </div>
      )}
    </Shell>
  );
}