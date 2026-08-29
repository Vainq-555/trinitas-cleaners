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

export async function attachEffectivePrice(service, customerId) {
  const price = await effectivePrice(service, customerId);
  return { ...service, price };
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
export async function adminSetGlobalPrice(req, res) {
  const { id } = req.params;
  const { basePrice } = req.body || {};
  if (typeof basePrice !== "number" || !Number.isFinite(basePrice) || basePrice < 0) {
    return badRequest(res, "basePrice must be a non-negative number");
  }
  const service = await prisma.service.update({ where: { id }, data: { basePrice } });
  res.json({ service });
}

// INDIVIDUAL price change: targets a specific customer account only.
export async function adminSetCustomerPrice(req, res) {
  const { id: serviceId } = req.params;
  const { customerId, price } = req.body || {};
  if (!customerId || typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    return badRequest(res, "customerId and a non-negative price are required");
  }

  const customer = await prisma.user.findUnique({ where: { id: customerId } });
  if (!customer) return badRequest(res, "Customer not found");

  const custom = await prisma.customPrice.upsert({
    where: { serviceId_customerId: { serviceId, customerId } },
    update: { price },
    create: { serviceId, customerId, price },
  });
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
