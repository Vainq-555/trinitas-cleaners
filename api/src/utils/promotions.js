function isEligible(promotion, { serviceId, subtotalCents, code, now }) {
  if (!promotion.active) return false;
  if (promotion.startsAt && now < new Date(promotion.startsAt)) return false;
  if (promotion.endsAt && now >= new Date(promotion.endsAt)) return false;
  if (promotion.maxUses !== null && promotion.maxUses !== undefined && promotion.usageCount >= promotion.maxUses) return false;
  if (promotion.minSubtotalCents !== null && promotion.minSubtotalCents !== undefined && subtotalCents < promotion.minSubtotalCents) return false;
  if (promotion.code && promotion.code !== code) return false;
  if (code && promotion.code !== code) return false;
  if (promotion.services?.length && !promotion.services.some((item) => item.serviceId === serviceId)) return false;
  return true;
}

function discountFor(promotion, subtotalCents) {
  if (promotion.discountType === "fixed") return Math.min(promotion.discountValue, subtotalCents);
  if (promotion.discountType !== "percentage") return 0;
  // Round half up using integers: basis points are hundredths of a percent.
  return Math.min(subtotalCents, Math.floor((subtotalCents * promotion.discountValue + 5000) / 10000));
}

export function selectBestPromotion(promotions, options) {
  return promotions
    .filter((promotion) => isEligible(promotion, options))
    .map((promotion) => ({ promotion, discountCents: discountFor(promotion, options.subtotalCents) }))
    .sort((a, b) => b.discountCents - a.discountCents || b.promotion.priority - a.promotion.priority || new Date(b.promotion.createdAt).getTime() - new Date(a.promotion.createdAt).getTime() || a.promotion.id.localeCompare(b.promotion.id))[0] || null;
}

export function calculatePreTaxQuote({ basePriceCents, promotions = [], serviceId, promoCode, now = new Date() }) {
  if (!Number.isInteger(basePriceCents) || basePriceCents < 0) throw new Error("Invalid base price");
  const selected = selectBestPromotion(promotions, { serviceId, subtotalCents: basePriceCents, code: promoCode, now });
  const discountCents = selected?.discountCents || 0;
  return {
    basePriceCents,
    discountCents,
    taxableSubtotalCents: basePriceCents - discountCents,
    promotion: selected?.promotion || null,
  };
}
