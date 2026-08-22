"use client";

import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Send, MessageCircle, Inbox,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDateTime } from "@/lib/api";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
];

export default function AdminMessagesPage() {
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [myId, setMyId] = useState(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadThreads = () =>
    api("/admin/messages/threads").then((d) => {
      setThreads(d.threads);
      if (!active && d.threads.length > 0) openThread(d.threads[0].customer.id);
    });

  const openThread = async (customerId) => {
    setActive(customerId);
    const d = await api(`/admin/messages/with/${customerId}`);
    setMessages(d.messages);
    await api(`/messages/read/${customerId}`, { method: "POST" }).catch(() => {});
  };

  useEffect(() => {
    api("/auth/me").then((me) => setMyId(me.user.id)).catch(() => {});
    loadThreads();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !active) return;
    setSending(true);
    try {
      await api("/messages", { method: "POST", body: { receiverId: active, content: draft } });
      setDraft("");
      await openThread(active);
      loadThreads();
    } finally {
      setSending(false);
    }
  };

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Communication Hub"
      subtitle="Reply directly to customers about issues, pricing, and custom requests.">
      <div className="grid gap-6 lg:grid-cols-[320px_1fr] items-start">
        {/* Threads */}
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-3.5 flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-light text-brand"><Inbox size={16} /></span>
            <h2 className="font-bold text-ink">Conversations</h2>
          </div>
          <div className="p-2.5 max-h-[600px] overflow-y-auto">
            {threads.length === 0 && (
              <p className="p-4 text-sm text-muted">No customer conversations yet.</p>
            )}
            {threads.map((t) => (
              <button
                key={t.customer.id}
                onClick={() => openThread(t.customer.id)}
                className={`w-full text-left rounded-xl p-3 transition-colors ${
                  active === t.customer.id ? "bg-brand-light" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink truncate">{t.customer.name}</span>
                  {t.unread > 0 && (
                    <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold uppercase text-white">new</span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted truncate">{t.lastMessage}</div>
                <div className="mt-1 text-[11px] text-muted">{fmtDateTime(t.lastAt)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Conversation */}
        <div className="card overflow-hidden flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: 460 }}>
          {!active ? (
            <div className="flex-1 grid place-items-center">
              <div className="text-center">
                <MessageCircle size={40} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm text-muted">Select a conversation to get started.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-light text-brand">
                  <MessageCircle size={18} />
                </span>
                <div>
                  <div className="font-bold text-ink">
                    {threads.find((t) => t.customer.id === active)?.customer.name || "Customer"}
                  </div>
                  <div className="text-xs text-muted">Direct conversation</div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto bg-slate-50/60 p-5 space-y-3">
                {messages.length === 0 && (
                  <div className="empty-state"><p className="font-semibold text-ink">No messages in this thread.</p></div>
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
              <form className="flex gap-2 border-t border-line p-3.5 bg-white" onSubmit={send}>
                <input className="input flex-1" placeholder="Reply to this customer…" value={draft}
                  onChange={(e) => setDraft(e.target.value)} />
                <button className="btn btn-primary" disabled={sending || !draft.trim()}>
                  <Send size={16} /> Send
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}