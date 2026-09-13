import prisma from "../utils/prisma.js";
import { badRequest, CONTENT_PAGES, isValidContentPage } from "../utils/validators.js";

const contentOrder = [{ order: "asc" }, { sectionKey: "asc" }];

// Express 4 does not catch rejected promises from async handlers. Route the
// rejection to the existing errorHandler instead of terminating the process.
// Handler signature is (req, res, next, db = prisma): Express passes `next` in
// the third slot; tests inject a fake db in that same third slot. A non-function
// third argument is therefore treated as the injected db.
const wrap = (fn) => (req, res, next, db = prisma) => {
  if (typeof next !== "function") [db, next] = [next, undefined];
  return Promise.resolve(fn(req, res, next, db)).catch(next);
};

function pageRequirement() {
  return `page must be one of: ${CONTENT_PAGES.join(", ")}`;
}

// ---- Public main site ----
// Public route: only active sections for a whitelisted page, no auth.
// With no ?serviceId the query is explicitly global (serviceId = null), so a
// service-scoped section can never appear on the global page. With
// ?serviceId=<id> only that service's sections are returned.
export const listPublicContent = wrap(async function listPublicContent(req, res, next, db = prisma) {
  const { page } = req.params;
  if (!isValidContentPage(page)) return res.status(404).json({ error: "Page not found" });
  const serviceId = req.query?.serviceId ?? null;
  const sections = await db.contentSection.findMany({
    where: { page, serviceId, isActive: true },
    orderBy: contentOrder,
  });
  res.json({ sections });
});

// ---- Admin: page content management ----
// Without ?serviceId lists global (serviceId = null) rows only; with
// ?serviceId=<id> lists that service's rows only. The two scopes never mix.
export const adminListContent = wrap(async function adminListContent(req, res, next, db = prisma) {
  const { page } = req.params;
  if (!isValidContentPage(page)) return badRequest(res, pageRequirement());
  const serviceId = req.query?.serviceId ?? null;
  const sections = await db.contentSection.findMany({
    where: { page, serviceId },
    orderBy: contentOrder,
  });
  res.json({ sections });
});

export const adminCreateContent = wrap(async function adminCreateContent(req, res, next, db = prisma) {
  const { page } = req.params;
  const { sectionKey, title, body, order = 0, isActive = true, serviceId = null } = req.body || {};

  if (!isValidContentPage(page)) return badRequest(res, pageRequirement());
  if (!sectionKey?.trim()) return badRequest(res, "sectionKey is required");
  if (!title?.trim()) return badRequest(res, "title is required");
  if (!body?.trim()) return badRequest(res, "body is required");
  if (!Number.isInteger(order) || order < 0) return badRequest(res, "order must be a non-negative integer");
  if (typeof isActive !== "boolean") return badRequest(res, "isActive must be a boolean");

  // Optional service scope. When supplied it must reference a real Service;
  // omitted/null/empty stores the section as global content.
  let scopeServiceId = null;
  if (serviceId !== null && serviceId !== undefined && serviceId !== "") {
    if (typeof serviceId !== "string") return badRequest(res, "serviceId must be a string");
    const service = await db.service.findUnique({ where: { id: serviceId } });
    if (!service) return badRequest(res, "Service not found");
    scopeServiceId = serviceId;
  }

  // Duplicate sectionKey is scoped: global rows are unique per (page, null,
  // sectionKey); each service's rows are unique per (page, serviceId,
  // sectionKey). The same sectionKey may be reused by different services.
  const existing = await db.contentSection.findFirst({
    where: { page, serviceId: scopeServiceId, sectionKey: sectionKey.trim() },
  });
  if (existing) return badRequest(res, "A section with this sectionKey already exists for this page");

  const section = await db.contentSection.create({
    data: {
      page,
      serviceId: scopeServiceId,
      sectionKey: sectionKey.trim(),
      title: title.trim(),
      body: body.trim(),
      order,
      isActive,
    },
  });
  res.status(201).json({ section });
});

export const adminUpdateContent = wrap(async function adminUpdateContent(req, res, next, db = prisma) {
  const { page, id } = req.params;
  if (!isValidContentPage(page)) return badRequest(res, pageRequirement());

  const existing = await db.contentSection.findUnique({ where: { id } });
  if (!existing || existing.page !== page) return res.status(404).json({ error: "Section not found" });

  // serviceId is immutable through PUT: a section cannot be moved between
  // global and service scope (or between services). Change scope by
  // delete/create instead.
  if (req.body && req.body.serviceId !== undefined) {
    return badRequest(res, "Scope cannot be changed through this endpoint");
  }

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
});

export const adminDeleteContent = wrap(async function adminDeleteContent(req, res, next, db = prisma) {
  const { page, id } = req.params;
  if (!isValidContentPage(page)) return badRequest(res, pageRequirement());

  const existing = await db.contentSection.findUnique({ where: { id } });
  if (!existing || existing.page !== page) return res.status(404).json({ error: "Section not found" });

  await db.contentSection.delete({ where: { id } });
  res.json({ ok: true });
});