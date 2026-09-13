import prisma from "../utils/prisma.js";
import { badRequest, CONTENT_PAGES, isValidContentPage } from "../utils/validators.js";

const contentOrder = [{ order: "asc" }, { sectionKey: "asc" }];

function pageRequirement() {
  return `page must be one of: ${CONTENT_PAGES.join(", ")}`;
}

// ---- Public main site ----
// Public route: only active sections for a whitelisted page, no auth.
export async function listPublicContent(req, res, db = prisma) {
  const { page } = req.params;
  if (!isValidContentPage(page)) return res.status(404).json({ error: "Page not found" });
  const sections = await db.contentSection.findMany({
    where: { page, isActive: true },
    orderBy: contentOrder,
  });
  res.json({ sections });
}

// ---- Admin: page content management ----
export async function adminListContent(req, res, db = prisma) {
  const { page } = req.params;
  if (!isValidContentPage(page)) return badRequest(res, pageRequirement());
  const sections = await db.contentSection.findMany({
    where: { page },
    orderBy: contentOrder,
  });
  res.json({ sections });
}

export async function adminCreateContent(req, res, db = prisma) {
  const { page } = req.params;
  const { sectionKey, title, body, order = 0, isActive = true } = req.body || {};

  if (!isValidContentPage(page)) return badRequest(res, pageRequirement());
  if (!sectionKey?.trim()) return badRequest(res, "sectionKey is required");
  if (!title?.trim()) return badRequest(res, "title is required");
  if (!body?.trim()) return badRequest(res, "body is required");
  if (!Number.isInteger(order) || order < 0) return badRequest(res, "order must be a non-negative integer");
  if (typeof isActive !== "boolean") return badRequest(res, "isActive must be a boolean");

  const existing = await db.contentSection.findUnique({
    where: { page_sectionKey: { page, sectionKey: sectionKey.trim() } },
  });
  if (existing) return badRequest(res, "A section with this sectionKey already exists for this page");

  const section = await db.contentSection.create({
    data: {
      page,
      sectionKey: sectionKey.trim(),
      title: title.trim(),
      body: body.trim(),
      order,
      isActive,
    },
  });
  res.status(201).json({ section });
}

export async function adminUpdateContent(req, res, db = prisma) {
  const { page, id } = req.params;
  if (!isValidContentPage(page)) return badRequest(res, pageRequirement());

  const existing = await db.contentSection.findUnique({ where: { id } });
  if (!existing || existing.page !== page) return res.status(404).json({ error: "Section not found" });

  const { sectionKey, title, body, order, isActive } = req.body || {};
  const data = {};
  if (sectionKey !== undefined) {
    if (!sectionKey?.trim()) return badRequest(res, "sectionKey cannot be empty");
    data.sectionKey = sectionKey.trim();
  }
  if (title !== undefined) {
    if (!title?.trim()) return badRequest(res, "title cannot be empty");
    data.title = title.trim();
  }
  if (body !== undefined) {
    if (!body?.trim()) return badRequest(res, "body cannot be empty");
    data.body = body.trim();
  }
  if (order !== undefined) {
    if (!Number.isInteger(order) || order < 0) return badRequest(res, "order must be a non-negative integer");
    data.order = order;
  }
  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") return badRequest(res, "isActive must be a boolean");
    data.isActive = isActive;
  }
  if (Object.keys(data).length === 0) return badRequest(res, "No valid fields to update");

  let section;
  try {
    section = await db.contentSection.update({ where: { id }, data });
  } catch (error) {
    if (error && error.code === "P2002") {
      return badRequest(res, "A section with this sectionKey already exists for this page");
    }
    throw error;
  }
  res.json({ section });
}

export async function adminDeleteContent(req, res, db = prisma) {
  const { page, id } = req.params;
  if (!isValidContentPage(page)) return badRequest(res, pageRequirement());

  const existing = await db.contentSection.findUnique({ where: { id } });
  if (!existing || existing.page !== page) return res.status(404).json({ error: "Section not found" });

  await db.contentSection.delete({ where: { id } });
  res.json({ ok: true });
}