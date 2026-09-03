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