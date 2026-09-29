"use client";

// EMPLOYEE → ADMIN MESSAGING — Phase 2B-3 ("Contact Admin").
//
// This page deliberately ships NO new messaging infrastructure. It reuses the
// endpoints the customer portal already uses, because the Phase 2A.1 server
// authorization is already correct for employees:
//
//   GET  /messages/with/:withId   -> own admin conversation + the admin row
//   POST /messages/read/:fromId   -> mark the admin's messages read
//   POST /messages                -> send, allowed only to an admin receiver
//
// Two server properties are what make this page safe, and neither is
// re-implemented here:
//
//  1. `GET /messages/with/:withId` IGNORES :withId for an employee and derives
//     the conversation from the session, so the literal "admin" below is a
//     placeholder, not a target. An employee cannot read another employee's
//     thread by editing this string. The server, not this file, is the
//     security boundary.
//  2. `POST /messages` is fail-closed server-side: a non-admin may only message
//     a user whose stored role is admin. So the recipient is not a choice —
//     there is no recipient input, picker, or user search here, and the only
//     recipient used is the `admin` the server itself returned.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "next/link";
import { MessageCircle, RotateCcw, Send } from "lucide-react";
import Shell from "@/components/Shell";
import { useAuth } from "@/lib/auth";
import { api, fmtDateTime } from "@/lib/api";
import { employeeNavLinks } from "@/lib/employeeNav";

const EMPTY_TITLE = "No messages with the admin yet.";
const EMPTY_BODY = "Use the box below to ask a question or raise an issue — the admin will reply here.";

export default function EmployeeMessagesPage() {
  const { user } = useAuth();
  const myId = user?.id;

  const [messages, setMessages] = useState([]);
  const [admin, setAdmin] = useState(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const bottomRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return api("/messages/with/admin")
      .then(async (d) => {
        setMessages(Array.isArray(d?.messages) ? d.messages : []);
        const a = d?.admin ?? null;
        setAdmin(a);
        // Best-effort: mark the admin's messages read. This only affects
        // unread badges, never the content being displayed, so a failure here
        // must not replace a readable conversation with an error screen.
        if (a?.id) await api(`/messages/read/${a.id}`, { method: "POST" }).catch(() => {});
        return d;
      })
      .catch((err) => {
        setLoadError(err);
        setMessages([]);
        setAdmin(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    // Empty/whitespace-only messages are never sent, and there is nothing to
    // send to if the server reported no admin. The server re-validates both.
    if (!draft.trim() || !admin || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api("/messages", {
        method: "POST",
        body: { receiverId: admin.id, content: draft },
      });
      setDraft("");
      await load();
    } catch (err) {
      // The draft is intentionally preserved so a failed send never discards
      // what the employee typed.
      setSendError(err);
    } finally {
      setSending(false);
    }
  };

  // A 401/403 means this session is no longer an authorized employee (for
  // example the account was disabled). Shown as a sign-in prompt, never as an
  // empty thread, so a revoked session cannot look like "no messages yet".
  const unauthorized = loadError?.status === 401 || loadError?.status === 403;

  return (
    <Shell
      links={employeeNavLinks()}
      sections={["Employee Portal"]}
      title="Contact Admin"
      subtitle="Ask a question or raise an issue — the admin replies here."
    >
      <div
        className="card overflow-hidden flex flex-col"
        style={{ height: "calc(100vh - 220px)", minHeight: 460 }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-light text-brand">
            <MessageCircle size={18} />
          </span>
          <div>
            <div className="font-bold text-ink">Trinitas-Cleaners Admin</div>
            <div className="text-xs text-muted">
              {admin ? admin.name : "Your only messaging contact"}
            </div>
          </div>
        </div>

        {/* Thread */}
        {loading ? (
          <div className="empty-state">Loading messages…</div>
        ) : unauthorized ? (
          <div className="empty-state">
            <p className="font-semibold text-ink">Your employee session is no longer active.</p>
            <p className="mt-1 text-sm text-muted">Please sign in again to contact the admin.</p>
            <Link href="/login" className="btn btn-primary mt-4">
              Go to sign in
            </Link>
          </div>
        ) : loadError ? (
          <div className="empty-state" role="alert">
            <p className="font-semibold text-ink">We could not load your messages.</p>
            <p className="mt-1 text-sm text-muted">
              This is a temporary problem, not an empty thread. Please try again.
            </p>
            <button className="btn btn-outline mt-4" onClick={load}>
              <RotateCcw size={16} /> Try again
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto bg-slate-50/60 p-5 space-y-3">
            {messages.length === 0 && (
              <div className="empty-state">
                <MessageCircle size={32} className="mx-auto text-slate-300" />
                <p className="mt-3 font-semibold text-ink">{EMPTY_TITLE}</p>
                <p className="mt-1 text-sm text-muted">{EMPTY_BODY}</p>
              </div>
            )}
            {messages.map((m) => {
              // Sent/received alignment comes from the sender id the server
              // returned, compared with the session user. A message whose sender
              // is not the session user is received — never assumed otherwise.
              const mine = m.sender.id === myId;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm break-words ${
                      mine
                        ? "bg-brand text-white rounded-br-sm"
                        : "bg-white border border-line text-ink rounded-bl-sm"
                    }`}
                  >
                    {m.content}
                    <div className={`mt-1 text-[11px] ${mine ? "text-white/70" : "text-muted"}`}>
                      {mine ? "You" : m.sender.name} · {fmtDateTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Composer */}
        {!unauthorized && !loadError ? (
          <form className="border-t border-line bg-white" onSubmit={send}>
            {sendError && (
              <p className="px-3.5 pt-3 text-sm text-danger" role="alert">
                Your message was not sent. Please try again.
              </p>
            )}
            <div className="flex gap-2 p-3.5">
              <input
                className="input flex-1"
                placeholder={
                  admin ? "Type a message to the admin…" : "No admin contact is available yet."
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={sending || !admin}
              />
              <button
                className="btn btn-primary"
                disabled={sending || !draft.trim() || !admin}
              >
                <Send size={16} /> {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </Shell>
  );
}
