import prisma from "../utils/prisma.js";
import { badRequest } from "../utils/validators.js";

/**
 * Resolve the effective price for a service given a customer.
 * A CustomPrice row (set by the admin for a specific account) overrides the
 * global basePrice. Otherwise the global basePrice applies.
 */
export async function effectivePrice(service, customerId) {
  if (customerId) {
    const override = await prisma.customPrice.findUnique({
      where: { serviceId_customerId: { serviceId: service.id, customerId } },
    });
    if (override) return override.price;
  }
  return service.basePrice;
}

/**
 * Resolve the effective MONTHLY price (USD cents) for a service given a
 * customer. Monthly billing must be enabled (Service.monthlyActive); a
 * per-customer CustomPrice.monthlyPriceCents override always wins over the
 * global Service.monthlyPriceCents. Returns null when monthly billing is not
 * available/configured. Mirrors the existing effectivePrice override behavior.
 */
export async function effectiveMonthlyPriceCents(service, customerId, db = prisma) {
  if (!service || service.monthlyActive !== true) return null;
  if (customerId) {
    const override = await db.customPrice.findUnique({
      where: { serviceId_customerId: { serviceId: service.id, customerId } },
    });
    if (override && Number.isInteger(override.monthlyPriceCents) && override.monthlyPriceCents >= 0) {
      return override.monthlyPriceCents;
    }
  }
  if (Number.isInteger(service.monthlyPriceCents) && service.monthlyPriceCents >= 0) {
    return service.monthlyPriceCents;
  }
  return null;
}

export async function attachEffectivePrice(service, customerId, db = prisma) {
  const price = await effectivePrice(service, customerId);
  const out = { ...service, price };
  if (customerId) {
    // Customer-effective MONTHLY price: the per-customer CustomPrice override
    // wins over the global Service.monthlyPriceCents — the exact value the
    // backend will snapshot when this customer starts a monthly subscription.
    // Unauthenticated/public responses keep the raw global monthly price and
    // no other customer's override is ever computed here.
    out.monthlyPriceCents = await effectiveMonthlyPriceCents(service, customerId, db);
  }
  return out;
}

// Public catalog (also honors a customer's personalized price when authenticated).
export async function listServices(req, res) {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  const customerId = req.user?.role === "customer" ? req.user.id : undefined;
  const out = [];
  for (const s of services) out.push(await attachEffectivePrice(s, customerId));
  res.json({ services: out });
}

// ---- Admin: pricing control ----

export async function adminListServices(req, res) {
  const services = await prisma.service.findMany({ orderBy: { name: "asc" } });
  res.json({ services });
}

export async function adminCreateService(req, res) {
  const { name, description, basePrice } = req.body || {};
  if (typeof name !== "string" || !name.trim() || (description !== undefined && typeof description !== "string") || typeof basePrice !== "number" || !Number.isFinite(basePrice) || basePrice < 0 || (req.body.isActive !== undefined && typeof req.body.isActive !== "boolean")) {
    return badRequest(res, "name and a non-negative basePrice are required");
  }
  const service = await prisma.service.create({
    data: {
      name: name.trim(),
      description: description?.trim() || "",
      basePrice,
      isActive: req.body.isActive ?? true,
    },
  });
  res.status(201).json({ service });
}

export async function adminUpdateService(req, res) {
  const { id } = req.params;
  const { name, description, basePrice, isActive } = req.body || {};
  if ((name !== undefined && (typeof name !== "string" || !name.trim())) || (description !== undefined && typeof description !== "string") || (basePrice !== undefined && (typeof basePrice !== "number" || !Number.isFinite(basePrice) || basePrice < 0)) || (isActive !== undefined && typeof isActive !== "boolean")) {
    return badRequest(res, "service fields are invalid");
  }
  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (description !== undefined) data.description = description.trim();
  if (basePrice !== undefined) data.basePrice = basePrice;
  if (typeof isActive === "boolean") data.isActive = isActive;

  const service = await prisma.service.update({ where: { id }, data });
  res.json({ service });
}

// GLOBAL price change: updates the base price for a service for everyone.
// Additively accepts the monthly pricing fields on the SAME endpoint so there
// is a single pricing system (no second pricing API): monthlyPriceCents is the
// global monthly price in USD cents and monthlyActive turns monthly booking
// on/off. One-time behavior is unchanged when the monthly fields are absent.
export async function adminSetGlobalPrice(req, res) {
  const { id } = req.params;
  const { basePrice, monthlyPriceCents, monthlyActive } = req.body || {};
  const hasBase = basePrice !== undefined;
  if (hasBase && (typeof basePrice !== "number" || !Number.isFinite(basePrice) || basePrice < 0)) {
    return badRequest(res, "basePrice must be a non-negative number");
  }
  if (monthlyPriceCents !== undefined && (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0)) {
    return badRequest(res, "monthlyPriceCents must be a non-negative integer in cents");
  }
  if (monthlyActive !== undefined && typeof monthlyActive !== "boolean") {
    return badRequest(res, "monthlyActive must be a boolean");
  }
  if (!hasBase && monthlyPriceCents === undefined && monthlyActive === undefined) {
    return badRequest(res, "basePrice, monthlyPriceCents, or monthlyActive is required");
  }
  const data = {
    ...(hasBase ? { basePrice } : {}),
    ...(monthlyPriceCents !== undefined ? { monthlyPriceCents } : {}),
    ...(monthlyActive !== undefined ? { monthlyActive } : {}),
  };
  const service = await prisma.service.update({ where: { id }, data });
  res.json({ service });
}

// INDIVIDUAL price change: targets a specific customer account only. Additively
// accepts the MONTHLY override lane on the SAME endpoint — monthlyPriceCents a
// non-negative integer in cents sets it, null clears ONLY the monthly lane
// (never the one-time price), and the one-time `price` lane is updated when and
// only when `price` is provided. Both lanes live on the one CustomPrice row.
export async function adminSetCustomerPrice(req, res) {
  const { id: serviceId } = req.params;
  const { customerId, price, monthlyPriceCents } = req.body || {};
  if (!customerId) return badRequest(res, "customerId is required");
  const hasPrice = price !== undefined;
  const hasMonthly = monthlyPriceCents !== undefined;
  if (hasPrice && (typeof price !== "number" || !Number.isFinite(price) || price < 0)) {
    return badRequest(res, "price must be a non-negative number");
  }
  if (hasMonthly && monthlyPriceCents !== null && (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0)) {
    return badRequest(res, "monthlyPriceCents must be a non-negative integer in cents, or null");
  }
  if (!hasPrice && !hasMonthly) {
    return badRequest(res, "price and/or monthlyPriceCents is required");
  }

  const customer = await prisma.user.findUnique({ where: { id: customerId } });
  if (!customer) return badRequest(res, "Customer not found");

  const key = { serviceId_customerId: { serviceId, customerId } };

  // Clearing ONLY the monthly override must never touch the one-time price and
  // must never create a CustomPrice row just to discard it.
  if (hasMonthly && monthlyPriceCents === null && !hasPrice) {
    const existing = await prisma.customPrice.findUnique({ where: key });
    if (!existing) return res.json({ customPrice: null });
    await prisma.customPrice.update({ where: key, data: { monthlyPriceCents: null } });
    return res.json({ customPrice: { ...existing, monthlyPriceCents: null } });
  }

  const update = {};
  if (hasPrice) update.price = price;
  if (hasMonthly) update.monthlyPriceCents = monthlyPriceCents;

  // CustomPrice.price is a required column, so a NEW row carrying only a monthly
  // override seeds it with the service's current global basePrice — the account's
  // effective one-time price is unchanged at creation time.
  const create = hasPrice
    ? { serviceId, customerId, price }
    : { serviceId, customerId, price: (await prisma.service.findUnique({ where: { id: serviceId } }))?.basePrice ?? 0 };
  if (hasMonthly) create.monthlyPriceCents = monthlyPriceCents;

  const custom = await prisma.customPrice.upsert({ where: key, update, create });
  res.json({ customPrice: custom });
}

export async function adminClearCustomerPrice(req, res) {
  const { id: serviceId } = req.params;
  const { customerId } = req.body || {};
  if (!customerId) return badRequest(res, "customerId is required");

  await prisma.customPrice
    .delete({ where: { serviceId_customerId: { serviceId, customerId } } })
    .catch(() => {});
  res.json({ ok: true });
}
