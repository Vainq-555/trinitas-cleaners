import test from "node:test";
import assert from "node:assert/strict";
import { calculatePreTaxQuote } from "../src/utils/promotions.js";
import { calculateFinalQuote } from "../src/utils/pricing.js";
import { calculateStripeTax, TaxAddressRequiredError, TaxUnavailableError, validateTaxAddress } from "../src/utils/tax.js";
import { assertPaidAmountMatches } from "../src/controllers/payments.js";
import { receiptSnapshotData } from "../src/controllers/payments.js";
import { claimPromotionUsage } from "../src/utils/promotionUsage.js";
import { dollarsToCents } from "../src/utils/money.js";

const address = { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" };
const promotion = (overrides = {}) => ({ id: "p1", name: "Promo", discountType: "percentage", discountValue: 1000, active: true, priority: 0, usageCount: 0, services: [], createdAt: "2026-01-01T00:00:00Z", ...overrides });

test("$40 service without promotion stays exact cents", () => {
  const quote = calculatePreTaxQuote({ basePriceCents: 4000, serviceId: "s1" });
  assert.deepEqual(quote, { basePriceCents: 4000, discountCents: 0, taxableSubtotalCents: 4000, promotion: null });
});

test("percentage and fixed discounts use integer cents", () => {
  assert.equal(calculatePreTaxQuote({ basePriceCents: 4000, serviceId: "s1", promotions: [promotion()] }).discountCents, 400);
  assert.equal(calculatePreTaxQuote({ basePriceCents: 4000, serviceId: "s1", promotions: [promotion({ discountType: "fixed", discountValue: 125 })] }).discountCents, 125);
});

test("zero discount and percentage rounding preserve exact cents", () => {
  assert.equal(calculatePreTaxQuote({ basePriceCents: 1, serviceId: "s1", promotions: [promotion({ discountValue: 0 })] }).discountCents, 0);
  assert.equal(calculatePreTaxQuote({ basePriceCents: 101, serviceId: "s1", promotions: [promotion({ discountValue: 333 })] }).discountCents, 3);
});

test("best savings wins, then priority breaks ties", () => {
  const quote = calculatePreTaxQuote({ basePriceCents: 4000, serviceId: "s1", promotions: [promotion({ id: "small", discountValue: 500, priority: 100 }), promotion({ id: "large", discountValue: 1500, priority: 0 })] });
  assert.equal(quote.promotion.id, "large");
  const tie = calculatePreTaxQuote({ basePriceCents: 4000, serviceId: "s1", promotions: [promotion({ id: "low", discountValue: 1000, priority: 1 }), promotion({ id: "high", discountValue: 1000, priority: 2 })] });
  assert.equal(tie.promotion.id, "high");
});

test("promo codes are exact and code-less promotions do not satisfy a code", () => {
  const exact = calculatePreTaxQuote({ basePriceCents: 1000, serviceId: "s1", promoCode: "SAVE10", promotions: [promotion({ code: "SAVE10" }), promotion({ id: "other", code: "save10", discountValue: 9000 })] });
  assert.equal(exact.promotion.code, "SAVE10");
  const wrongCase = calculatePreTaxQuote({ basePriceCents: 1000, serviceId: "s1", promoCode: "save10", promotions: [promotion({ code: "SAVE10" })] });
  assert.equal(wrongCase.promotion, null);
});

test("expired, disabled, restricted, and minimum promotions are ignored", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const quote = calculatePreTaxQuote({ basePriceCents: 4000, serviceId: "s1", now, promotions: [promotion({ id: "expired", endsAt: "2026-01-01T00:00:00Z", discountValue: 9000 }), promotion({ id: "off", active: false, discountValue: 9000 }), promotion({ id: "min", minSubtotalCents: 5000, discountValue: 9000 }), promotion({ id: "restricted", services: [{ serviceId: "s2" }], discountValue: 9000 })] });
  assert.equal(quote.promotion, null);
});

test("discount cannot make subtotal negative", () => {
  const quote = calculatePreTaxQuote({ basePriceCents: 100, serviceId: "s1", promotions: [promotion({ discountType: "fixed", discountValue: 10000 })] });
  assert.equal(quote.discountCents, 100);
  assert.equal(quote.taxableSubtotalCents, 0);
});

test("final quote preserves tax result and exact cents", () => {
  const quote = calculateFinalQuote({ basePriceCents: 4000, serviceId: "s1", promotions: [promotion()], tax: { taxCents: 253, taxRateBasisPoints: 725, taxCalculationId: "tax_1" } });
  assert.equal(quote.taxableSubtotalCents, 3600);
  assert.equal(quote.finalAmountCents, 3853);
  assert.equal(Number.isInteger(quote.finalAmountCents), true);
});

test("final amount is always taxable subtotal plus provider tax", () => {
  const quote = calculateFinalQuote({ basePriceCents: 999, serviceId: "s1", tax: { taxCents: 67 } });
  assert.equal(quote.basePriceCents, 999);
  assert.equal(quote.discountCents, 0);
  assert.equal(quote.taxableSubtotalCents, 999);
  assert.equal(quote.finalAmountCents, 1066);
  assert.equal(Number.isInteger(quote.finalAmountCents), true);
});

test("custom-price cents conversion and receipt snapshot preserve the authoritative total", () => {
  assert.equal(dollarsToCents(27.5), 2750);
  const data = receiptSnapshotData(
    { id: "b1", customerId: "u1", basePriceCents: 2750, discountCents: 250, taxableSubtotalCents: 2500, taxRateBasisPoints: 725, taxCents: 181, finalAmountCents: 2681 },
    { finalAmountCents: 2681 },
  );
  assert.equal(data.finalAmountCents, 2681);
  assert.equal(data.total, 26.81);
  assert.equal(data.taxableSubtotalCents + data.taxCents, data.finalAmountCents);
});

test("Stripe Tax uses service address and exclusive cents amount", async () => {
  let request;
  const stripe = { tax: { calculations: { create: async (params) => { request = params; return { id: "tax_1", tax_amount_exclusive: 253, line_items: { data: [{ tax_breakdown: [{ tax_rate_details: { percentage_decimal: "7.25" } }] }] } }; } } } };
  const result = await calculateStripeTax({ stripe, amountCents: 3600, serviceId: "s1", address });
  assert.equal(request.line_items[0].amount, 3600);
  assert.equal(request.customer_details.address.postal_code, "55303");
  assert.equal(result.taxCents, 253);
  assert.equal(result.taxRateBasisPoints, 725);
});

test("tax provider failure and incomplete address fail safely", async () => {
  await assert.rejects(() => calculateStripeTax({ stripe: { tax: { calculations: { create: async () => { throw new Error("unavailable"); } } } }, amountCents: 100, serviceId: "s1", address }), TaxUnavailableError);
  await assert.rejects(() => calculateStripeTax({ stripe: { tax: { calculations: { create: async () => { throw new Error("must not be called"); } } } }, amountCents: 100, serviceId: "s1", address: {} }), TaxAddressRequiredError);
  assert.throws(() => validateTaxAddress({}), TaxAddressRequiredError);
});

test("webhook amount mismatch is rejected in cents", () => {
  assert.doesNotThrow(() => assertPaidAmountMatches(3853, 3853));
  assert.throws(() => assertPaidAmountMatches(3853, 3852), (error) => error.code === "PAYMENT_AMOUNT_MISMATCH");
  assert.throws(() => assertPaidAmountMatches(3853, undefined), (error) => error.code === "PAYMENT_AMOUNT_MISMATCH");
  assert.throws(() => assertPaidAmountMatches(3853, "3853"), (error) => error.code === "PAYMENT_AMOUNT_MISMATCH");
});

function promotionUsageTx({ maxUses = null, usageCount = 0 } = {}) {
  const state = { claimedAt: null, maxUses, usageCount };
  let lock = Promise.resolve();
  return {
    state,
    $queryRaw: async () => {
      const previous = lock;
      let release;
      lock = new Promise((resolve) => { release = resolve; });
      await previous;
      state.release = release;
      return [{ promotionUsageClaimedAt: state.claimedAt }];
    },
    $executeRaw: async () => {
      if (state.maxUses !== null && state.usageCount >= state.maxUses) {
        state.release?.();
        state.release = null;
        return 0;
      }
      state.usageCount += 1;
      return 1;
    },
    booking: { update: async () => { state.claimedAt = new Date(); state.release?.(); state.release = null; } },
  };
}

test("promotion usage is idempotent, limited, and unlimited claims are counted", async () => {
  const tx = promotionUsageTx({ maxUses: 1 });
  const booking = { id: "b1", promotionId: "p1" };
  assert.equal(await claimPromotionUsage(tx, booking), true);
  assert.equal(await claimPromotionUsage(tx, booking), false);
  assert.equal(tx.state.usageCount, 1);

  const limited = promotionUsageTx({ maxUses: 1, usageCount: 1 });
  await assert.rejects(() => claimPromotionUsage(limited, { id: "b2", promotionId: "p1" }), (error) => error.code === "PROMOTION_UNAVAILABLE");
  const unlimited = promotionUsageTx();
  assert.equal(await claimPromotionUsage(unlimited, { id: "b3", promotionId: "p1" }), true);
  assert.equal(unlimited.state.usageCount, 1);
});

test("promotion usage claims serialize concurrent attempts for one booking", async () => {
  const tx = promotionUsageTx({ maxUses: 1 });
  const booking = { id: "b1", promotionId: "p1" };
  const results = await Promise.all([claimPromotionUsage(tx, booking), claimPromotionUsage(tx, booking)]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(tx.state.usageCount, 1);
});
