import prisma from "./prisma.js";
import { hashPassword } from "./password.js";
import { generateResetToken, hashResetToken, isResetTokenExpired, RESET_TOKEN_TTL_MS } from "./resetToken.js";
import { buildResetUrl, buildResetEmail, sendEmail } from "./mail.js";
import { PUBLIC_WEB_URL } from "../config.js";

// Password-recovery orchestration, kept separate from the auth controller so
// the recovery flow is testable and the controller stays thin.
//
// Scalar-response contract (anti-enumeration): forgot-password always returns
// the SAME public message regardless of whether the email belongs to an
// account, and (by design) regardless of whether delivery succeeded. Only the
// HTTP status differs for malformed input / rate-limit, never account existence.
//
// The service uses dependency injection so tests can supply in-memory fakes
// and never connect to a database or the email provider (see defaultDeps).

// Public, enumeration-safe response used for both existing and unknown emails.
const GENERIC_FORGOT_MESSAGE = "If an account exists for that email, a password reset link has been sent.";

const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(email) {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

export function isValidNewPassword(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

const defaultDeps = {
  prisma,
  hashPassword,
  sendEmail,
  now: () => new Date(),
};

export function createPasswordRecovery(deps = defaultDeps) {
  const { prisma: db, hashPassword: hash, sendEmail: mailer, now } = deps;
  const delay = () => new Date(now().getTime() + RESET_TOKEN_TTL_MS);

  return {
    // Requests a reset for `email`. NEVER reveals account existence. On
    // provider failure the freshly created token is deleted (so it cannot later
    // be redeemed) and the same generic response is returned; the provider
    // error is logged server-side without secrets, never surfaced to clients.
    async requestPasswordReset(email) {
      const normalized = normalizeEmail(email);
      let user = null;
      try {
        user = await db.user.findUnique({ where: { email: normalized } });
      } catch {
        // DB errors must not reveal account existence either.
        return { message: GENERIC_FORGOT_MESSAGE };
      }

      if (user) {
        // Invalidate any previous unused reset tokens before issuing a new one.
        await db.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: now() },
        });

        const { rawToken, tokenHash } = generateResetToken();
        await db.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: delay(),
          },
        });

        const resetUrl = buildResetUrl(PUBLIC_WEB_URL, rawToken);
        const emailContent = buildResetEmail({ name: user.name, resetUrl });

        try {
          await mailer({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          });
        } catch (error) {
          // Never leave a valid-but-undelivered token behind.
          await db.passwordResetToken.deleteMany({ where: { userId: user.id, tokenHash } });
          // Server-side, secret-free diagnostic only.
          // eslint-disable-next-line no-console
          console.error("[password-recovery] reset email could not be sent:", error && error.message ? error.message : "unknown error");
        }
      }

      return { message: GENERIC_FORGOT_MESSAGE };
    },

    // Redeems a raw reset token and replaces the account password. Returns a
    // discriminated result; the controller maps it to a safe HTTP response.
    async performPasswordReset(rawToken, newPassword) {
      if (!rawToken || !isValidNewPassword(newPassword)) {
        return { ok: false, reason: "INVALID_INPUT", status: 400 };
      }

      const tokenHash = hashResetToken(rawToken).toLowerCase();
      const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });

      if (!record || record.usedAt || isResetTokenExpired(record.expiresAt)) {
        return { ok: false, reason: "TOKEN_INVALID", status: 400 };
      }

      const user = await db.user.findUnique({ where: { id: record.userId } });
      if (!user) return { ok: false, reason: "TOKEN_INVALID", status: 400 };

      const newHash = await hash(newPassword);
      await db.$transaction([
        db.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }),
        db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now() } }),
      ]);

      return { ok: true };
    },
  };
}

// Default singleton bound to the real prisma/mail/hash implementations. The
// controller imports these; tests construct their own with fakes.
const recovery = createPasswordRecovery(defaultDeps);
export const requestPasswordReset = recovery.requestPasswordReset;
export const performPasswordReset = recovery.performPasswordReset;

export { RESET_TOKEN_TTL_MS };

export function assertPasswordPolicy(password) {
  if (!isValidNewPassword(password)) {
    return "Password must be at least 8 characters";
  }
  return null;
}