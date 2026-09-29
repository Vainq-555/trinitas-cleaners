import crypto from "node:crypto";
import prisma from "./prisma.js";
import { hashPassword } from "./password.js";
import { sendEmail } from "./mail.js";
import { ROLES, PUBLIC_WEB_URL } from "../config.js";
import { isValidNewPassword } from "./passwordRecovery.js";

// Employee account INVITATION — dedicated, single-use, expiring credential.
//
// This is deliberately NOT the password-recovery token. It lives in its own
// table (EmployeeInvitation) and its digest is purpose-prefixed, so a password
// reset token can never be redeemed as an employee invitation and an employee
// invitation can never be redeemed as a password reset. Password recovery
// (utils/passwordRecovery.js) is read-only here: only its shared password-policy
// helper is reused.
//
// Security contract:
//   - rawToken is 256 bits of crypto.randomBytes, base64url for URL safety.
//   - ONLY the purpose-prefixed SHA-256 digest is persisted.
//   - the raw token exists solely inside the emailed activation URL; it is never
//     returned by any API response, never logged, and never stored.
//   - single-use: usedAt is stamped atomically on successful activation.
//   - expiring: expiresAt is enforced server-side on every redemption.
//   - the subject account comes from the token record ONLY, so an activation
//     request can never activate a different user than the invitee.
//   - the email never contains a password or any privileged data.

// Invitations are valid for 24 hours: long enough for an employee to receive and
// act on the email, short enough that an unclaimed link is not a standing risk.
export const INVITATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Domain separation: the persisted digest is prefixed with the token's purpose,
// so the same raw string can never produce a valid digest in another namespace.
const TOKEN_PURPOSE = "employee-invitation";

export function generateInvitationToken() {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashInvitationToken(rawToken) };
}

export function hashInvitationToken(rawToken) {
  return crypto
    .createHash("sha256")
    .update(`${TOKEN_PURPOSE}:${String(rawToken)}`)
    .digest("hex");
}

export function isInvitationExpired(expiresAt) {
  const deadline = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isNaN(deadline) || deadline <= Date.now();
}

// Activation link. Always built from the configured web URL, never the API host.
export function buildInvitationUrl(webUrl, rawToken) {
  const base = String(webUrl || PUBLIC_WEB_URL).replace(/\/+$/, "");
  return `${base}/activate-employee?token=${encodeURIComponent(rawToken)}`;
}

// Invitation email (HTML + plain text). Contains the name, a one-time link and
// the expiry — never a password, never a token shown separately, and never any
// customer, booking or payment data.
export function buildInvitationEmail({
  name,
  invitationUrl,
  expiresAtMs = Date.now() + INVITATION_TOKEN_TTL_MS,
}) {
  const subject = "Activate your Trinitas-Cleaners employee account";
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
    "An administrator created an employee account for you at Trinitas-Cleaners.",
    "",
    "Choose your password and activate your account using the link below:",
    invitationUrl,
    "",
    `This link expires on ${expiryLabel} and can only be used once.`,
    "",
    "If you were not expecting this invitation, ignore this email. No account is created until the link is used.",
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
        <p>An administrator created an employee account for you at Trinitas-Cleaners.</p>
        <p>To choose your password and activate your account, click the button below:</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${invitationUrl}" style="display:inline-block;background:#0b6b5a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;">Activate my account</a>
        </p>
        <p style="font-size:13px;color:#7a8087;">Or open this link in your browser:<br/>${invitationUrl}</p>
        <p style="font-size:13px;color:#7a8087;">This link expires on ${expiryLabel} and can only be used once.</p>
        <p style="font-size:13px;color:#7a8087;">If you were not expecting this invitation, you can safely ignore this email.</p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, html, text, invitationUrl, expiresAtMs };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A freshly invited employee has NO usable password: we store the bcrypt hash of
// 256 bits of random data, so no password can ever match it, and the employee
// must set their own through the invitation flow. The admin never sees or sets
// it, and the raw value is discarded immediately.
export async function createUnusablePasswordHash(hash = hashPassword) {
  return hash(crypto.randomBytes(32).toString("base64url"));
}

const defaultDeps = {
  prisma,
  hashPassword,
  sendEmail,
  now: () => new Date(),
};

// Dependency-injected so tests can supply in-memory fakes and never touch a
// database or a mail provider.
export function createEmployeeInvitationService(deps = defaultDeps) {
  const { prisma: db, hashPassword: hash, sendEmail: mailer, now } = deps;
  const deadline = () => new Date(now().getTime() + INVITATION_TOKEN_TTL_MS);

  return {
    // Issues a single-use invitation for an already-created employee user.
    // Any previous UNUSED invitation for that user is invalidated first, so only
    // the newest link can ever be redeemed. On delivery failure the new token is
    // deleted so an undelivered invitation can never be redeemed later, and the
    // caller is told the send failed (server-side detail only, never the token).
    async issueInvitation(user, webUrl = PUBLIC_WEB_URL) {
      await db.employeeInvitation.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now() },
      });

      const { rawToken, tokenHash } = generateInvitationToken();
      const expiresAt = deadline();
      await db.employeeInvitation.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      const invitationUrl = buildInvitationUrl(webUrl, rawToken);
      const content = buildInvitationEmail({ name: user.name, invitationUrl, expiresAtMs: expiresAt.getTime() });

      try {
        await mailer({
          to: user.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
        });
        return { ok: true, expiresAt };
      } catch (error) {
        // Never leave a valid-but-undelivered token behind.
        await db.employeeInvitation.deleteMany({ where: { userId: user.id, tokenHash } });
        // Server-side, secret-free diagnostic only.
        // eslint-disable-next-line no-console
        console.error(
          "[employee-invitation] invitation email could not be sent:",
          error && error.message ? error.message : "unknown error",
        );
        return { ok: false, reason: "MAIL_FAILED" };
      }
    },

    // Redeems a raw invitation token and sets the employee's first password.
    // The subject is resolved from the token record alone: the request carries
    // no user id, so it can never activate an account other than the invitee's.
    // Every failure (unknown / expired / already-used / wrong role / disabled)
    // returns an identical, non-revealing result.
    async activateWithToken(rawToken, newPassword) {
      if (!rawToken || !isValidNewPassword(newPassword)) {
        return { ok: false, reason: "INVALID_INPUT", status: 400 };
      }

      const tokenHash = hashInvitationToken(rawToken);
      const record = await db.employeeInvitation.findUnique({ where: { tokenHash } });

      if (!record || record.usedAt || isInvitationExpired(record.expiresAt)) {
        return { ok: false, reason: "TOKEN_INVALID", status: 400 };
      }

      const user = await db.user.findUnique({ where: { id: record.userId } });
      // An invitation can only ever activate an employee account, and never a
      // disabled one (a disabled employee must not be able to self-restore).
      if (!user || user.role !== ROLES.EMPLOYEE || user.disabledAt) {
        return { ok: false, reason: "TOKEN_INVALID", status: 400 };
      }

      const newHash = await hash(newPassword);
      await db.$transaction([
        db.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }),
        db.employeeInvitation.update({ where: { id: record.id }, data: { usedAt: now() } }),
      ]);

      return { ok: true };
    },
  };
}

const service = createEmployeeInvitationService(defaultDeps);
export const issueInvitation = service.issueInvitation;
export const activateWithToken = service.activateWithToken;
