"use client";

import { useEffect, useRef, useState } from "react";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  Send, MessageCircle,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDateTime } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function MessagesPage() {
  const [messages, setMessages] = useState([]);
  const [admin, setAdmin] = useState(null);
  const [draft, setDraft] = useState("");
  const [myId, setMyId] = useState(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const load = () =>
    api("/auth/me")
      .then(async (me) => {
        setMyId(me.user.id);
        const d = await api("/messages/with/admin");
        setMessages(d.messages);
        setAdmin(d.admin);
        return d.admin.id;
      })
      .then((adminId) => api(`/messages/read/${adminId}`, { method: "POST" }).catch(() => {}));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !admin) return;
    setSending(true);
    try {
      await api("/messages", { method: "POST", body: { receiverId: admin.id, content: draft } });
      setDraft("");
      load();
    } finally {
      setSending(false);
    }
  };

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Message the Admin"
      subtitle="Questions, issues, custom requests — we'll get back to you here.">
      <div className="card overflow-hidden flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: 420 }}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-clean-light text-clean">
            <MessageCircle size={18} />
          </span>
          <div>
            <div className="font-bold text-ink">Trinitas-Cleaners Support</div>
            <div className="text-xs text-muted">Typically replies within one business day</div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-slate-50/60 p-5 space-y-3">
          {messages.length === 0 && (
            <div className="empty-state">
              <p className="font-semibold text-ink">No messages yet.</p>
              <p className="text-sm">Say hello or ask about a custom job below.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender.id === myId ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                m.sender.id === myId
                  ? "bg-brand text-white rounded-br-sm"
                  : "bg-white border border-line text-ink rounded-bl-sm"
              }`}>
                {m.content}
                <div className={`mt-1 text-[11px] ${m.sender.id === myId ? "text-white/70" : "text-muted"}`}>
                  {m.sender.id === myId ? "You" : m.sender.name} · {fmtDateTime(m.createdAt)}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form className="flex gap-2 border-t border-line p-3.5 bg-white" onSubmit={send}>
          <input
            className="input flex-1"
            placeholder="Type a message to Trinitas-Cleaners…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn btn-primary" disabled={sending || !draft.trim()}>
            <Send size={16} /> Send
          </button>
        </form>
      </div>
    </Shell>
  );
}