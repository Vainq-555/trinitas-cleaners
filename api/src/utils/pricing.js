import { calculatePreTaxQuote } from "./promotions.js";

export function calculateFinalQuote({ basePriceCents, promotions, serviceId, promoCode, preTax: suppliedPreTax, tax }) {
  const preTax = suppliedPreTax || calculatePreTaxQuote({ basePriceCents, promotions, serviceId, promoCode });
  if (!tax || !Number.isInteger(tax.taxCents) || tax.taxCents < 0) throw new Error("Authoritative tax is required");
  return {
    ...preTax,
    taxCents: tax.taxCents,
    taxRateBasisPoints: tax.taxRateBasisPoints ?? null,
    taxCalculationId: tax.taxCalculationId,
    finalAmountCents: preTax.taxableSubtotalCents + tax.taxCents,
  };
}

export function promotionSnapshot(quote) {
  const p = quote.promotion;
  return p
    ? { promotionId: p.id, promotionCodeSnapshot: p.code || null, promotionNameSnapshot: p.name, promotionDiscountTypeSnapshot: p.discountType, promotionDiscountValueSnapshot: p.discountValue }
    : { promotionId: null, promotionCodeSnapshot: null, promotionNameSnapshot: null, promotionDiscountTypeSnapshot: null, promotionDiscountValueSnapshot: null };
}
