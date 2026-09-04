import { RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, PUBLIC_WEB_URL } from "../config.js";
import { RESET_TOKEN_TTL_MS } from "./resetToken.js";

// Mail service for transactional password-recovery email. Kept separate from
// the auth controller so provider specifics live in one place and can be
// swapped/mocked easily. Uses Resend's REST API (no SDK dependency) so the
// transport is trivially injectable for tests; no real email is ever sent by
// the test suite.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Builds the reset URL. Must always use the configured production web URL and
// HTTPS; never localhost or the API host.
export function buildResetUrl(webUrl, rawToken) {
  const base = String(webUrl || PUBLIC_WEB_URL).replace(/\/+$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

// Renders the reset email (HTML + plain text). No marketing content, no
// unsubscribe framing, no password, and no separate token display.
export function buildResetEmail({ name, resetUrl, expiresAtMs = Date.now() + RESET_TOKEN_TTL_MS }) {
  const subject = "Reset your Trinitas-Cleaners password";
  const expiryLabel = new Date(expiresAtMs).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const greeting = name ? `Hi ${name},` : "Hello,";

  const text = [
    greeting,
    "",
    "We received a request to reset the password for your Trinitas-Cleaners account.",
    "",
    "To choose a new password, open the link below:",
    resetUrl,
    "",
    `This link expires on ${expiryLabel} and can only be used once.`,
    "",
    "If you did not request a password reset, you can safely ignore this email. No changes have been made to your account.",
    "",
    "— Trinitas-Cleaners",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
      <div style="background:#0b6b5a;padding:20px 28px;color:#ffffff;">
        <strong>Trinitas-Cleaners</strong>
      </div>
      <div style="padding:28px;color:#2b2f36;font-size:15px;line-height:1.55;">
        <p>${escapeHtml(greeting)}</p>
        <p>We received a request to reset the password for your Trinitas-Cleaners account.</p>
        <p>To choose a new password, click the button below:</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${resetUrl}" style="display:inline-block;background:#0b6b5a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;">Reset my password</a>
        </p>
        <p style="font-size:13px;color:#7a8087;">Or open this link in your browser:<br/>${resetUrl}</p>
        <p style="font-size:13px;color:#7a8087;">This link expires on ${expiryLabel} and can only be used once.</p>
        <p style="font-size:13px;color:#7a8087;">If you did not request a password reset, you can safely ignore this email. No changes have been made to your account.</p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, html, text, resetUrl, expiresAtMs };
}

// Default transport posts to Resend's REST API. Injected for tests; never
// invoked when no API key is configured.
export async function resendTransport({ to, from, replyTo, subject, html, text }) {
  if (!RESEND_API_KEY) {
    const err = new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
    err.providerUnavailable = true;
    throw err;
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: replyTo || undefined,
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const err = new Error(`EMAIL_PROVIDER_ERROR`);
    err.providerUnavailable = true;
    throw err;
  }
  return { ok: true };
}

// Sends a transactional email through the provided transport (defaults to
// Resend). Never logs the recipient, subject, tokens, or any secret.
export async function sendEmail({ to, from = EMAIL_FROM, replyTo = EMAIL_REPLY_TO, subject, html, text, transport = resendTransport }) {
  if (!from) {
    const err = new Error("EMAIL_FROM_NOT_CONFIGURED");
    err.providerUnavailable = true;
    throw err;
  }
  return transport({ to, from, replyTo, subject, html, text });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// ==== BOOKING CONFIRMATION EMAIL ====

// Sends a booking confirmation email after a successful payment.
// - booking: the Prisma Booking record
// - stripeEventId: optional Stripe event ID (for online payments) — used for duplicate protection
// - prisma: Prisma client instance (optional — note update is skipped if not provided)
export async function sendBookingConfirmationEmail(booking, stripeEventId, prisma) {
  // --- Duplicate‑email check (online only) ---
  if (stripeEventId && booking.note?.includes(`stripe_event:${stripeEventId}`)) {
    return { sent: false, reason: 'duplicate' };
  }

  // --- Build email content from actual booking fields ---
  const customer = prisma?.booking?.findUnique?.({
    where: { id: booking.id },
    include: { customer: true },
  });
  const custName = customer?.name || 'Customer';
  const service = booking.service?.name || 'Service';
  const date = new Date(booking.date).toLocaleString('en‑US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const address = booking.taxAddressLine1
    ? `${booking.taxAddressLine1}${booking.taxAddressLine2 ? ' ' + booking.taxAddressLine2 : ''}`
    : '—';
  const cityStatePostal = `${booking.taxAddressCity}, ${booking.taxAddressState} ${booking.taxAddressPostalCode}`;
  const country = booking.taxAddressCountry || '—';
  const priceInfo =`
    Base: $${(booking.basePriceCents / 100).toFixed(2)}
    Discount: $${(booking.discountCents / 100).toFixed(2) || 0}
    Tax: $${(booking.taxCents / 100).toFixed(2)}
    **Total: $${(booking.finalAmountCents / 100).toFixed(2)}**`;

  const text = [
    'Trinitas‑Cleaners Booking Confirmation',
    '================================',
    `Customer: ${custName}`,
    `Service: ${service}`,
    `Date/Time: ${date}`,
    `Address: ${address}`,
    `${cityStatePostal}, ${country}`,
    '',
    'Price Details',
    priceInfo,
    `Payment Method: ${booking.payment?.method || '—'}`,
    `Payment Status: ${booking.payment?.status || '—'}`,
    '',
    'Please log in to your dashboard to view or modify your booking.',
    `${PUBLIC_WEB_URL}/dashboard/bookings`,
    '— Trinitas‑Cleaners',
  ].join('\n');

  const html = `<!doctype html>
  <html>
  <body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;">
    <h2>Your Trinitas‑Cleaners Booking Confirmation</h2>
    <p>Dear ${custName},</p>
    <p>Thank you for your booking. Below are the details of your reservation:</p>
    <ul>
      <li><strong>Service:</strong> ${service}</li>
      <li><strong>Date/Time:</strong> ${date}</li>
      <li><strong>Address:</strong> ${address}</li>
      <li><strong>Price Details:</strong><br/>${priceInfo}</li>
      <li><strong>Payment Method:</strong> ${booking.payment?.method || '—'}</li>
      <li><strong>Payment Status:</strong> ${booking.payment?.status || '—'}</li>
    </ul>
    <p>You can manage your booking at <a href="${PUBLIC_WEB_URL}/dashboard/bookings">your dashboard</a>.</p>
    <p>If you have any questions, please reply to this email.</p>
    <p>— Trinitas‑Cleaners</p>
  </body>
  </html>`;

  // --- Send via existing Resend transport ---
  try {
    await sendEmail({
      to: booking.customer?.email || 'customer@example.com',
      from: EMAIL_FROM,
      replyTo: EMAIL_REPLY_TO,
      subject: 'Your Trinitas‑Cleaners Booking Confirmation',
      html,
      text,
    });

    // --- Duplicate‑email protection (online only) ---
    if (stripeEventId) {
      await prisma?.booking.update({
        where: { id: booking.id },
        data: { note: `${booking.note ?? ''} | stripe_event:${stripeEventId}` },
      });
    }

    return { sent: true, reason: null };
  } catch (err) {
    // Log safely — no secrets, no raw tokens
    console.error('[booking confirmation] email failed', {
      bookingId: booking.id,
      error: err?.message ?? 'unknown error',
    });
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

// =============================================================================
