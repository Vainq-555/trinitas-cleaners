import Stripe from "stripe";
import { STRIPE_SECRET_KEY } from "../config.js";

export class TaxUnavailableError extends Error {
  constructor(message = "Tax calculation is temporarily unavailable. Please try again.") {
    super(message);
    this.code = "TAX_UNAVAILABLE";
  }
}

export class TaxAddressRequiredError extends TaxUnavailableError {
  constructor(message = "A complete service address is required to calculate tax.") {
    super(message);
    this.code = "TAX_ADDRESS_REQUIRED";
  }
}

export function validateTaxAddress(address) {
  const required = ["line1", "city", "state", "postalCode", "country"];
  if (!address || required.some((key) => typeof address[key] !== "string" || !address[key].trim())) {
    throw new TaxAddressRequiredError();
  }
  return {
    line1: address.line1.trim(),
    ...(address.line2?.trim() ? { line2: address.line2.trim() } : {}),
    city: address.city.trim(),
    state: address.state.trim().toUpperCase(),
    postal_code: address.postalCode.trim(),
    country: address.country.trim().toUpperCase(),
  };
}

function percentageToBasisPoints(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export async function calculateStripeTax({ stripe, amountCents, serviceId, address }) {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new TaxUnavailableError();
  const client = stripe || (STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null);
  if (!client) throw new TaxUnavailableError();
  const taxAddress = validateTaxAddress(address);
  let calculation;
  try {
    calculation = await client.tax.calculations.create({
      currency: "usd",
      line_items: [{ amount: amountCents, reference: serviceId, tax_behavior: "exclusive" }],
      customer_details: { address: taxAddress, address_source: "shipping" },
    });
  } catch (error) {
    const safeMessage = String(error?.message || "Unknown Stripe error")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    console.error("Stripe Tax calculation failed", {
      type: error?.type ?? null,
      code: error?.code ?? null,
      httpStatus: error?.statusCode ?? error?.status ?? null,
      requestId: error?.requestId ?? error?.request_id ?? null,
      message: safeMessage,
    });
    if (error?.code === "stripe_tax_inactive") {
      const err = new TaxUnavailableError(safeMessage || "Stripe Tax is not activated. Please enable it in the Stripe dashboard.");
      err.retryable = false;
      throw err;
    }
    throw new TaxUnavailableError();
  }
  if (!Number.isInteger(calculation.tax_amount_exclusive) || calculation.tax_amount_exclusive < 0) throw new TaxUnavailableError();
  const rate = calculation.line_items?.data?.[0]?.tax_breakdown?.[0]?.tax_rate_details?.percentage_decimal;
  return { taxCents: calculation.tax_amount_exclusive, taxRateBasisPoints: percentageToBasisPoints(rate), taxCalculationId: calculation.id };
}
