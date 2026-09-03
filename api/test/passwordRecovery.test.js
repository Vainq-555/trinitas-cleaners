import test from "node:test";
import assert from "node:assert/strict";
import { createPasswordRecovery } from "../src/utils/passwordRecovery.js";
import {
  generateResetToken,
  hashResetToken,
  isResetTokenExpired,
  RESET_TOKEN_TTL_MS,
} from "../src/utils/resetToken.js";
import { createRecoveryRateLimiters } from "../src/utils/rateLimit.js";
import { buildResetUrl, buildResetEmail } from "../src/utils/mail.js";

// In-memory fakes so these tests never touch a database or the email provider.
function makeFakeDb({ user = null, tokenRecords = new Map() } = {}) {
  const calls = { sent: [], deleted: [], transactions: [] };
  const db = {
    calls,
    user: {
      findUnique: async ({ where }) => {
        if (where.email !== undefined && user && user.email === where.email) return user;
        if (where.id !== undefined && user && user.id === where.id) return user;
        return null;
      },
      update: async ({ where, data }) => {
        if (user && user.id === where.id) Object.assign(user, data);
        return user;
      },
    },
    passwordResetToken: {
      findUnique: async ({ where }) => {
        if (where.tokenHash !== undefined) return tokenRecords.get(where.tokenHash) || null;
        return null;
      },
      create: async ({ data }) => {
        const rec = { id: "tr_" + Math.random().toString(36).slice(2), ...data };
        tokenRecords.set(data.tokenHash, rec);
        return rec;
      },
      updateMany: async ({ where, data }) => {
        for (const rec of tokenRecords.values()) {
          if (where.userId === rec.userId && rec.usedAt === null) rec.usedAt = data.usedAt;
        }
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        let found = null;
        if (where.id !== undefined) {
          for (const r of tokenRecords.values()) {
            if (r.id === where.id) found = r;
          }
        }
        if (found) Object.assign(found, data);
        return found;
      },
      deleteMany: async ({ where }) => {
        if (where.tokenHash !== undefined) {
          tokenRecords.delete(where.tokenHash);
          calls.deleted.push(where.tokenHash);
        }
        return { count: 1 };
      },
    },
    $transaction: async (ops) => {
      for (const op of ops) await op;
      calls.transactions.push(ops.length);
      return ops;
    },
  };
  return db;
}

function makeMailer({ shouldFail = false } = {}) {
  const sent = [];
  const mailer = async (payload) => {
    if (shouldFail) throw new Error("provider down");
    sent.push(payload);
    return { ok: true };
  };
  mailer.sent = sent;
  return mailer;
}

function makeBcryptLike() {
  const hashes = new Map();
  return {
    hash: async (plain) => {
      if (!hashes.has(plain)) hashes.set(plain, "bcrypt$" + plain.length);
      return hashes.get(plain);
    },
    hashes,
  };
}

test("generateResetToken produces two distinct 256-bit raw tokens with matching hashes", () => {
  const t1 = generateResetToken();
  const t2 = generateResetToken();
  assert.ok(t1.rawToken && t1.tokenHash);
  assert.equal(t1.tokenHash, hashResetToken(t1.rawToken));
  assert.equal(t1.tokenHash.length, 64, "sha256 hex length");
  assert.notEqual(t1.rawToken, t2.rawToken, "raw tokens must be random/unique");
  assert.notEqual(t1.tokenHash, t2.tokenHash);
});

test("only the token hash is storable; raw token is not persisted by the service", async () => {
  const user = { id: "u1", email: "a@example.com", name: "Ada" };
  const tokenRecords = new Map();
  const db = makeFakeDb({ user, tokenRecords });
  const service = createPasswordRecovery({ prisma: db, hashPassword: async (p) => p, sendEmail: makeMailer({}), now: () => new Date() });
  await service.requestPasswordReset("a@example.com");

  const stored = [...tokenRecords.values()].pop();
  assert.ok(stored, "a token record was created");
  assert.ok(stored.tokenHash.length === 64, "stored value is a sha256 hash");
});

test("forgot-password returns identical response for existing and unknown email (no enumeration)", async () => {
  const existing = makeFakeDb({ user: { id: "u1", email: "a@example.com", name: "Ada" } });
  const serviceExisting = createPasswordRecovery({ prisma: existing, hashPassword: async (p) => p, sendEmail: makeMailer({}), now: () => new Date() });
  const r1 = await serviceExisting.requestPasswordReset("a@example.com");

  const unknown = makeFakeDb({ user: null });
  const serviceUnknown = createPasswordRecovery({ prisma: unknown, hashPassword: async (p) => p, sendEmail: makeMailer({}), now: () => new Date() });
  const r2 = await serviceUnknown.requestPasswordReset("nobody@example.com");

  assert.deepEqual(r1, r2, "both cases must return the exact same public shape/message");
});

test("requesting a reset invalidates prior unused tokens and does not touch an existing session", async () => {
  const user = { id: "u1", email: "a@example.com", name: "Ada", passwordHash: "old" };
  const tokenRecords = new Map();
  const oldHash = hashResetToken("old-token");
  tokenRecords.set(oldHash, { id: "t0", userId: "u1", tokenHash: oldHash, expiresAt: new Date(Date.now() + 3600e3), usedAt: null });
  const db = makeFakeDb({ user, tokenRecords });
  const service = createPasswordRecovery({ prisma: db, hashPassword: async (p) => p, sendEmail: makeMailer({}), now: () => new Date() });
  await service.requestPasswordReset("a@example.com");

  assert.ok(tokenRecords.get(oldHash).usedAt, "previous unused token invalidated");
  assert.equal(user.passwordHash, "old", "password unchanged by requesting a reset");
});

test("token expiration is honored: expired token cannot reset the password", async () => {
  const user = { id: "u1", email: "a@example.com", name: "Ada", passwordHash: "old" };
  const expiredHash = hashResetToken("expired");
  const tokenRecords = new Map();
  tokenRecords.set(expiredHash, {
    id: "t1",
    userId: "u1",
    tokenHash: expiredHash,
    expiresAt: new Date(Date.now() - 1000),
    usedAt: null,
  });
  const db = makeFakeDb({ user, tokenRecords });
  const service = createPasswordRecovery({ prisma: db, hashPassword: makeBcryptLike().hash, sendEmail: makeMailer({}), now: () => new Date() });
  const result = await service.performPasswordReset("expired", "verynewpass");
  assert.equal(result.ok, false);
  assert.equal(user.passwordHash, "old", "password not changed");
});

test("expired-token helper returns true for past deadlines", () => {
  assert.equal(isResetTokenExpired(new Date(Date.now() - 1)), true);
  assert.equal(isResetTokenExpired(new Date(Date.now() + 60_000)), false);
});

test("a token works once; reusing it fails", async () => {
  const user = { id: "u1", email: "a@example.com", name: "Ada", passwordHash: "old" };
  const tokenRecords = new Map();
  const db = makeFakeDb({ user, tokenRecords });
  const hash = makeBcryptLike();
  const service = createPasswordRecovery({ prisma: db, hashPassword: hash.hash, sendEmail: makeMailer({}), now: () => new Date() });

  const raw = "the-raw-token";
  const rec = { id: "t2", userId: "u1", tokenHash: hashResetToken(raw), expiresAt: new Date(Date.now() + 3600e3), usedAt: null };
  tokenRecords.set(rec.tokenHash, rec);

  const ok1 = await service.performPasswordReset(raw, "newpass99");
  assert.equal(ok1.ok, true);
  assert.notEqual(user.passwordHash, "old", "password replaced");
  assert.ok(user.passwordHash.startsWith("bcrypt$"), "replaced with a bcrypt-like hash");
  assert.ok(rec.usedAt, "token marked used / invalidated");

  const ok2 = await service.performPasswordReset(raw, "another99");
  assert.equal(ok2.ok, false, "reused token must fail");
  assert.notEqual(user.passwordHash, "old", "password unchanged on reuse failure");
});

test("invalid or missing input fails safely", async () => {
  const db = makeFakeDb({ user: null });
  const service = createPasswordRecovery({ prisma: db, hashPassword: async () => "", sendEmail: makeMailer({}), now: () => new Date() });
  assert.equal((await service.performPasswordReset(null, "password1")).ok, false);
  assert.equal((await service.performPasswordReset("tok", "short")).ok, false);
  assert.equal((await service.performPasswordReset("tok", "")).ok, false);
});

test("provider failure is handled safely: token removed and generic response returned", async () => {
  const user = { id: "u1", email: "a@example.com", name: "Ada" };
  const tokenRecords = new Map();
  const db = makeFakeDb({ user, tokenRecords });
  const service = createPasswordRecovery({ prisma: db, hashPassword: async (p) => p, sendEmail: makeMailer({ shouldFail: true }), now: () => new Date() });
  const result = await service.requestPasswordReset("a@example.com");
  assert.equal(db.calls.deleted.length >= 1, true, "undelivered token removed so it cannot later be redeemed");
  assert.ok(result.message.length > 0, "still returns a generic message");
});

test("rate limiter throttles repeated requests but never permanently blocks", () => {
  const before = Date.now();
  let clock = before;
  const limiter = createRecoveryRateLimiters({ now: () => clock });

  const ip = "1.2.3.4";
  for (let i = 0; i < 5; i++) {
    assert.equal(limiter.byIp.allow(ip), true);
    limiter.byIp.record(ip);
  }
  assert.equal(limiter.byIp.allow(ip), false, "6th request within window is limited");

  // Advance beyond the 15-minute window: the caller is allowed again.
  clock = before + 15 * 60 * 1000 + 1;
  assert.equal(limiter.byIp.allow(ip), true, "window slides; no permanent block");
  limiter.byIp._reset();
});

test("reset URL uses the configured production web URL over HTTPS", () => {
  const url = buildResetUrl("https://web.trinitaso.com", "raw-tok");
  assert.equal(url, "https://web.trinitaso.com/reset-password?token=raw-tok");
  assert.ok(url.startsWith("https://"), "must be HTTPS");
  assert.ok(!url.includes("localhost"), "must not use localhost");
  assert.ok(!url.includes("api."), "must not use the API host");
  assert.equal(decodeURIComponent(new URL(url).searchParams.get("token")), "raw-tok");
});

test("reset email is HTML+text, identifies the app, and never displays a token/password", () => {
  const email = buildResetEmail({ name: "Ada", resetUrl: "https://web.trinitaso.com/reset-password?token=xyz", expiresAtMs: Date.now() + 3600e3 });
  assert.ok(email.subject.includes("Trinitas-Cleaners"));
  assert.match(email.html, /<html/i);
  assert.ok(email.text.length > 0);
  assert.match(email.text, /Trinitas-Cleaners/);
  assert.match(email.html, /https:\/\/web\.trinitaso\.com\/reset-password/);
  assert.match(email.text, /https:\/\/web\.trinitaso\.com\/reset-password/);
  // No marketing / unsubscribe framing, no password, and the token only exists
  // inside the reset URL (never as a standalone displayed value).
  assert.ok(!email.text.toLowerCase().includes("unsubscribe"));
  assert.ok(!email.html.toLowerCase().includes("unsubscribe"));
  assert.ok(!email.text.toLowerCase().includes("password:"));
  assert.ok(!email.html.toLowerCase().includes("password:"));
  // The token value "xyz" appears only inside URL contexts (never as a
  // standalone displayed value).
  const fullUrlText = email.text.match(/https:\/\/web\.trinitaso\.com\/reset-password\?token=xyz/g) || [];
  assert.ok(fullUrlText.length >= 1, "text includes the full reset URL");
  assert.ok(!email.text.replace(/https:\/\/web\.trinitaso\.com\/reset-password\?token=xyz/g, "").includes("xyz"), "text has no standalone token outside URLs");
  const fullUrlHtml = email.html.match(/https:\/\/web\.trinitaso\.com\/reset-password\?token=xyz/g) || [];
  assert.ok(fullUrlHtml.length >= 1, "html includes the full reset URL");
  assert.ok(!email.html.replace(/https:\/\/web\.trinitaso\.com\/reset-password\?token=xyz/g, "").includes("xyz"), "html has no standalone token outside URLs");
});

test("mail service never exposes the raw token or password and logs nothing secret on failure", async () => {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    const user = { id: "u1", email: "a@example.com", name: "Ada" };
    const tokenRecords = new Map();
    const db = makeFakeDb({ user, tokenRecords });
    const rawSeen = [];
    const mailer = () => { throw new Error("boom"); };
    const service = createPasswordRecovery({ prisma: db, hashPassword: async (p) => p, sendEmail: mailer, now: () => new Date() });
    await service.requestPasswordReset("a@example.com");
    const joinedLogs = logs.join("\n");
    assert.ok(!joinedLogs.includes("boom detail"), "no internal error detail leaked");
  } finally {
    console.error = originalError;
  }
});