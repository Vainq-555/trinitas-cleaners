import prisma from "../utils/prisma.js";
import { badRequest } from "../utils/validators.js";
import { ROLES } from "../config.js";

const userBrief = { id: true, name: true, email: true, role: true, status: true };

// Communication hub: customers message the admin, admins reply to customers.

export async function sendMessage(req, res) {
  const { receiverId, content } = req.body || {};
  if (!receiverId || !content?.trim()) {
    return badRequest(res, "receiverId and content are required");
  }

  const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
  if (!receiver) return badRequest(res, "Receiver not found");

  // Customers may only message admins; admins may message any customer.
  // Fail-closed: only "admin" may message an arbitrary receiver. Testing "is a
  // customer" instead would let any future role message anyone by default.
  if (req.user.role !== ROLES.ADMIN && receiver.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Customers can only contact the admin" });
  }

  const message = await prisma.message.create({
    data: {
      senderId: req.user.id,
      receiverId,
      content: content.trim(),
    },
    include: { sender: { select: userBrief }, receiver: { select: userBrief } },
  });

  res.status(201).json({ message });
}

export async function listConversation(req, res) {
  const { withId } = req.params;

  // Customers AND employees may only ever read their OWN conversation with the
  // admin. The roles are explicitly enumerated — never "any role that is not
  // admin" — so a future role cannot inherit this reach. `withId` is ignored
  // here exactly as it is for a customer, so neither can read a third party's
  // thread (an employee's admin correspondence is never reachable this way).
  if (req.user.role === ROLES.CUSTOMER || req.user.role === ROLES.EMPLOYEE) {
    const admin = await prisma.user.findFirst({
      where: { role: ROLES.ADMIN },
      // Explicit projection: `admin` is returned to the client, and a bare
      // findFirst would ship the admin's passwordHash (and every other User
      // column) with it.
      select: userBrief,
    });
    if (!admin) return res.json({ messages: [] });
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: req.user.id, receiverId: admin.id },
          { senderId: admin.id, receiverId: req.user.id },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: { sender: { select: userBrief } },
    });
    return res.json({ messages, admin });
  }

  // Fail-closed: only "admin" may read a conversation with an arbitrary
  // counterpart. Any other role is denied here instead of falling through to
  // the admin branch below, so a future role can never inherit admin reach.
  // The customer/employee branch above always returns, so neither ever reaches
  // this.
  if (req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Forbidden: insufficient role" });
  }

  // Admin: conversation with a specific customer, employee or anyone else.
  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: req.user.id, receiverId: withId },
        { senderId: withId, receiverId: req.user.id },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: userBrief } },
  });
  res.json({ messages });
}

// Mark messages from a sender as read.
export async function markRead(req, res) {
  const { fromId } = req.params;
  await prisma.message.updateMany({
    where: { senderId: fromId, receiverId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
}

// Admin: threads with all customers, newest first.
export async function adminListThreads(req, res) {
  const messages = await prisma.message.findMany({
    orderBy: { createdAt: "desc" },
    include: { sender: { select: userBrief }, receiver: { select: userBrief } },
  });

  const map = new Map();
  for (const m of messages) {
    const other =
      m.sender.id === req.user.id ? m.receiver : m.sender;
    if (!map.has(other.id)) {
      map.set(other.id, {
        // `customer` is retained unchanged for existing consumers (the admin UI
        // and any client reading this field). It is simply the counterpart row.
        customer: other,
        // Phase 2B-3: employees are real messaging counterparts, so the thread
        // is labelled from the STORED role rather than assumed to be a customer.
        // Derived from User.role server-side; the client never infers it from a
        // name, an email or a display heuristic.
        counterpartType: other.role,
        lastMessage: m.content,
        lastAt: m.createdAt,
        unread: !m.readAt && m.sender.id !== req.user.id,
      });
    }
  }

  res.json({ threads: [...map.values()] });
}