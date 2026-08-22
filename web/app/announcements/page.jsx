"use client";

import { useEffect, useState } from "react";
import { Megaphone, CalendarDays } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { api, fmtDate } from "@/lib/api";

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/broadcasts/public")
      .then((d) => setAnnouncements(d.broadcasts))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="mx-auto max-w-3xl w-full px-4 sm:px-6 py-12 flex-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
          <Megaphone size={13} /> News &amp; Updates
        </span>
        <h1 className="mt-4 page-title">Announcements</h1>
        <p className="mt-3 text-muted">
          Holiday hours, seasonal specials, and news from Trinitas-Cleaners.
        </p>

        <div className="mt-8 space-y-4">
          {loading ? (
            <div className="empty-state">Loading announcements…</div>
          ) : announcements.length === 0 ? (
            <div className="card p-10 text-center">
              <Megaphone size={32} className="mx-auto text-slate-300" />
              <p className="mt-3 font-semibold text-ink">No announcements right now.</p>
              <p className="text-sm text-muted">Check back soon for news and updates.</p>
            </div>
          ) : (
            announcements.map((a) => (
              <div key={a.id} className="announcement-card">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand">
                  <Megaphone size={13} /> Announcement
                </div>
                {a.title && <h3 className="mt-2 text-lg font-bold text-ink">{a.title}</h3>}
                <p className="mt-1.5 text-slate-700 leading-relaxed">{a.content}</p>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                  <CalendarDays size={13} /> {fmtDate(a.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}