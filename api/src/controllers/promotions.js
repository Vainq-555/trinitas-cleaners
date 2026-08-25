import prisma from "../utils/prisma.js";
import { badRequest } from "../utils/validators.js";
import { dollarsToCents, percentageToBasisPoints } from "../utils/money.js";

function normalizeDiscount(type, value) {
  if (!["percentage", "fixed"].includes(type) || typeof value !== "number" || value < 0) throw new Error("discountType and a valid discountValue are required");
  return type === "percentage" ? percentageToBasisPoints(value) : dollarsToCents(value);
}

export async function adminListPromotions(req, res) {
  const promotions = await prisma.promotion.findMany({ orderBy: [{ active: "desc" }, { priority: "desc" }, { createdAt: "desc" }], include: { services: true } });
  res.json({ promotions });
}

export async function adminCreatePromotion(req, res) {
  const { code, name, description, discountType, discountValue, startsAt, endsAt, active = true, minSubtotal, priority = 0, maxUses, serviceIds = [] } = req.body || {};
  if (!name || !Array.isArray(serviceIds)) return badRequest(res, "name and serviceIds are required");
  let storedValue;
  try { storedValue = normalizeDiscount(discountType, discountValue); } catch (error) { return badRequest(res, error.message); }
  const minSubtotalCents = minSubtotal === undefined || minSubtotal === null || minSubtotal === "" ? null : dollarsToCents(Number(minSubtotal));
  const promotion = await prisma.promotion.create({
    data: {
      code: code?.trim() || null,
      name: name.trim(),
      description: description?.trim() || null,
      discountType,
      discountValue: storedValue,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
      active: active !== false,
      minSubtotalCents,
      priority: Number.isInteger(priority) ? priority : 0,
      maxUses: maxUses === null || maxUses === undefined || maxUses === "" ? null : Number(maxUses),
      services: { create: serviceIds.map((serviceId) => ({ service: { connect: { id: serviceId } } })) },
    },
    include: { services: true },
  });
  res.status(201).json({ promotion });
}

export async function adminUpdatePromotion(req, res) {
  const { id } = req.params;
  const { name, description, active, startsAt, endsAt, priority, maxUses } = req.body || {};
  const data = {};
  if (typeof name === "string") data.name = name.trim();
  if (description !== undefined) data.description = description?.trim() || null;
  if (typeof active === "boolean") data.active = active;
  if (startsAt !== undefined) data.startsAt = startsAt ? new Date(startsAt) : null;
  if (endsAt !== undefined) data.endsAt = endsAt ? new Date(endsAt) : null;
  if (Number.isInteger(priority)) data.priority = priority;
  if (maxUses !== undefined) data.maxUses = maxUses === null || maxUses === "" ? null : Number(maxUses);
  const promotion = await prisma.promotion.update({ where: { id }, data, include: { services: true } });
  res.json({ promotion });
}
