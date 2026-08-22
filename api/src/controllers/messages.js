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
  if (req.user.role === ROLES.CUSTOMER && receiver.role !== ROLES.ADMIN) {
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

  if (req.user.role === ROLES.CUSTOMER) {
    // Customers only ever see their conversation with the admin.
    const admin = await prisma.user.findFirst({ where: { role: ROLES.ADMIN } });
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

  // Admin: conversation with a specific customer.
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
        customer: other,
        lastMessage: m.content,
        lastAt: m.createdAt,
        unread: !m.readAt && m.sender.id !== req.user.id,
      });
    }
  }

  res.json({ threads: [...map.values()] });
}