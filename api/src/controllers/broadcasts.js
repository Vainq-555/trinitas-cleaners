import prisma from "../utils/prisma.js";
import { badRequest, isValidBroadcastTarget, isValidBroadcastType } from "../utils/validators.js";

// ---- Public main site ----
export async function listPublicBroadcasts(req, res) {
  const broadcasts = await prisma.broadcast.findMany({
    where: { target: "public", type: "announcement" },
    orderBy: { createdAt: "desc" },
  });
  res.json({ broadcasts });
}

// ---- Customers: announcements/notifications targeted at them ----
export async function listMyBroadcasts(req, res) {
  const broadcasts = await prisma.broadcast.findMany({
    where: {
      OR: [{ target: "all" }, { target: "specific_user", userId: req.user.id }],
    },
    orderBy: { createdAt: "desc" },
  });

  const reads = await prisma.userBroadcastRead.findMany({
    where: { userId: req.user.id },
    select: { broadcastId: true },
  });
  const readSet = new Set(reads.map((r) => r.broadcastId));

  res.json({
    broadcasts: broadcasts.map((b) => ({ ...b, read: readSet.has(b.id) })),
  });
}

export async function markBroadcastRead(req, res) {
  const { id } = req.params;
  const existing = await prisma.userBroadcastRead.findUnique({
    where: { userId_broadcastId: { userId: req.user.id, broadcastId: id } },
  });
  if (!existing) {
    await prisma.userBroadcastRead.create({
      data: { userId: req.user.id, broadcastId: id },
    });
  }
  res.json({ ok: true });
}

// ---- Admin: publish notifications / announcements ----
export async function adminCreateBroadcast(req, res) {
  const { type, target, title, content, userId } = req.body || {};

  if (!isValidBroadcastType(type)) return badRequest(res, "type must be notification | announcement");
  if (!isValidBroadcastTarget(target)) {
    return badRequest(res, "target must be public | all | specific_user");
  }
  if (!content?.trim()) return badRequest(res, "content is required");
  if (target === "specific_user" && !userId) {
    return badRequest(res, "userId is required when targeting a specific customer");
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      type,
      target,
      title: title || null,
      content: content.trim(),
      userId: target === "specific_user" ? userId : null,
    },
  });
  res.status(201).json({ broadcast });
}

export async function adminListBroadcasts(req, res) {
  const broadcasts = await prisma.broadcast.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json({ broadcasts });
}

export async function adminDeleteBroadcast(req, res) {
  const { id } = req.params;
  await prisma.broadcast.delete({ where: { id } }).catch(() => {});
  res.json({ ok: true });
}