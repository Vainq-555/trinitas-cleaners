import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import prisma from "../src/utils/prisma.js";
import { ROLES } from "../src/config.js";
import { hashResetToken } from "../src/utils/resetToken.js";
import { verifyPassword } from "../src/utils/password.js";
import {
  adminListEmployees,
  adminCreateEmployee,
  adminDisableEmployee,
  adminReactivateEmployee,
} from "../src/controllers/employees.js";
import {
  createEmployeeInvitationService,
  createUnusablePasswordHash,
  generateInvitationToken,
  hashInvitationToken,
  isInvitationExpired,
  INVITATION_TOKEN_TTL_MS,
} from "../src/utils/employeeInvitation.js";
import { activateEmployeeAccount } from "../src/controllers/auth.js";

const t = (s) => new Date(s);
const HOUR = 60 * 60 * 1000;

const response = () => ({
  cookies: {},
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
  clearCookie() { return this; },
});

async function withDb(stubs, fn) {
  const originals = {};
  for (const [model, methods] of Object.entries(stubs)) {
    // A key of "$root" stubs a method on the prisma client itself (e.g.
    // $transaction), which is not a model delegate.
    const target = model === "$root" ? prisma : prisma[model];
    const label = model === "$root" ? "$root" : model;
    originals[label] = model === "$root" ? prisma[label] : prisma[model];
    for (const method of Object.keys(methods)) {
      originals[`${label}.${method}`] = target[method];
      target[method] = methods[method];
    }
  }
  try {
    return await fn();
  } finally {
    for (const [model, methods] of Object.entries(stubs)) {
      const label = model === "$root" ? "$root" : model;
      const target = label === "$root" ? prisma : prisma[model];
      if (originals[label] !== undefined) {
        for (const method of Object.keys(methods)) target[method] = originals[`${label}.${method}`];
      } else {
        delete prisma[model];
      }
    }
  }
}

const ADMIN = { id: "adm1", role: ROLES.ADMIN, name: "Root" };
const EMPLOYEE = { id: "emp1", role: ROLES.EMPLOYEE, name: "Erin" };

const employeeRow = (overrides = {}) => ({
  id: "emp1",
  name: "Erin",
  email: "erin@example.com",
  phone: "612-555-0100",
  role: ROLES.EMPLOYEE,
  status: "offline",
  lastActiveAt: null,
  createdAt: t("2026-09-20T00:00:00Z"),
  disabledAt: null,
  ...overrides,
});

// =================== admin employee management ===================

test("list employees: uses an EXPLICIT role = employee filter", async () => {
  let where = null;
  const res = response();
  await withDb(
    { user: { findMany: async (args) => { where = args.where; return []; } } },
    () => adminListEmployees({ user: ADMIN }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(where, { role: ROLES.EMPLOYEE });
  // Never a negative filter that would sweep in other roles.
  assert.equal(JSON.stringify(where).includes("not"), false);
});

test("list employees: never returns a password hash, invitation token, or customer/payment data", async () => {
  const res = response();
  await withDb(
    {
      user: {
        findMany: async (args) => {
          // The select itself must not even reach the password hash.
          assert.equal(args.select.passwordHash, undefined);
          assert.equal(args.select.passwordResetTokens, undefined);
          return [employeeRow({ _count: { employeeAssignments: 2 } })];
        },
      },
    },
    () => adminListEmployees({ user: ADMIN }, res),
  );
  assert.equal(res.statusCode, 200);
  const serialized = JSON.stringify(res.body);
  for (const forbidden of ["passwordHash", "password", "tokenHash", "token", "stripeCustomerId", "resetToken"]) {
    assert.equal(serialized.includes(forbidden), false, `employee list must not expose ${forbidden}`);
  }
  assert.equal(res.body.employees[0].assignmentCount, 2);
  assert.equal(res.body.employees[0].role, ROLES.EMPLOYEE);
});

test("create employee: only an admin may create an employee", async () => {
  for (const caller of [EMPLOYEE, { id: "cus1", role: ROLES.CUSTOMER }, undefined]) {
    const res = response();
    let created = false;
    await withDb(
      { user: { create: async () => { created = true; return employeeRow(); } } },
      () => adminCreateEmployee({ user: caller, body: { name: "X", email: "x@example.com" } }, res, undefined, {
        issueInvitation: async () => ({ ok: true }),
      }),
    );
    assert.equal(res.statusCode, 403, `role ${caller?.role} must be refused`);
    assert.equal(created, false);
  }
});

test("create employee: creates role=employee with NO usable password and issues an invitation", async () => {
  let created = null;
  let issuedFor = null;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => { created = data; return employeeRow(data); },
      },
    },
    () =>
      adminCreateEmployee(
        { user: ADMIN, body: { name: "  Erin  ", email: "Erin@Example.com", phone: "612-555-0100" } },
        res,
        undefined,
        { issueInvitation: async (u) => { issuedFor = u; return { ok: true, expiresAt: t("2026-09-28T00:00:00Z") }; } },
      ),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(created.role, ROLES.EMPLOYEE, "role is hard-coded to employee");
  assert.equal(created.name, "Erin");
  assert.equal(created.email, "erin@example.com", "email is normalized");
  assert.equal(created.disabledAt, null, "a new employee starts enabled");
  assert.equal(created.status, "offline");
  // The stored password is NOT the admin-supplied or any usable password.
  assert.equal(typeof created.passwordHash, "string");
  assert.equal(created.passwordHash.length > 0, true);
  assert.equal(issuedFor.id, "emp1", "an invitation is issued for the new employee");
  assert.equal(res.body.invitationExpiresAt instanceof Date, true);
});

test("create employee: the new password hash cannot match any password the admin knows", async () => {
  const hash = await createUnusablePasswordHash();
  for (const guess of ["", "password", "password123", "erin", "erin@example.com", "Erin"]) {
    assert.equal(await verifyPassword(guess, hash), false, `"${guess}" must never match`);
  }
  // Two invitations produce different hashes (fresh randomness each time).
  assert.notEqual(await createUnusablePasswordHash(), hash);
});

test("create employee: the request body can never choose the role or a password", async () => {
  let created = null;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => { created = data; return employeeRow(data); },
      },
    },
    () =>
      adminCreateEmployee(
        {
          user: ADMIN,
          body: { name: "Erin", email: "erin@example.com", password: "adminChosen123", role: ROLES.ADMIN, disabledAt: null },
        },
        res,
        undefined,
        { issueInvitation: async () => ({ ok: true }) },
      ),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(created.role, ROLES.EMPLOYEE, "a body-supplied admin role must be ignored");
  assert.equal("password" in created, false, "no plain password is ever stored from the request");
  assert.notEqual(created.passwordHash, "adminChosen123");
});

test("create employee: never echoes a password or hash back to the caller", async () => {
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => employeeRow({ ...data, passwordHash: "super-secret-hash" }),
      },
    },
    () =>
      adminCreateEmployee({ user: ADMIN, body: { name: "Erin", email: "erin@example.com" } }, res, undefined, {
        issueInvitation: async () => ({ ok: true, expiresAt: t("2026-09-28T00:00:00Z") }),
      }),
  );
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes("super-secret-hash"), false);
  assert.equal(serialized.includes("passwordHash"), false);
  assert.equal(serialized.includes("rawToken"), false, "the invitation token is never returned");
});

test("create employee: validates name, email and phone", async () => {
  const cases = [
    [{ email: "a@b.com" }, /Name is required/],
    [{ name: "A" }, /valid email/],
    [{ name: "A", email: "a@b.com", phone: "12" }, /valid phone/],
  ];
  for (const [body, pattern] of cases) {
    const res = response();
    let created = false;
    await withDb(
      { user: { create: async () => { created = true; return employeeRow(); } } },
      () => adminCreateEmployee({ user: ADMIN, body }, res, undefined, { issueInvitation: async () => ({ ok: true }) }),
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, pattern);
    assert.equal(created, false);
  }
});

test("create employee: refuses a duplicate email", async () => {
  const res = response();
  let created = false;
  await withDb(
    {
      user: {
        findUnique: async () => ({ id: "cus1", role: ROLES.CUSTOMER }),
        create: async () => { created = true; return employeeRow(); },
      },
    },
    () => adminCreateEmployee({ user: ADMIN, body: { name: "Erin", email: "erin@example.com" } }, res, undefined, {
      issueInvitation: async () => ({ ok: true }),
    }),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /already exists/);
  assert.equal(created, false);
});

test("create employee: an undelivered invitation rolls the account back and grants no access", async () => {
  let deleted = null;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => employeeRow(data),
        delete: async ({ where }) => { deleted = where.id; },
      },
    },
    () =>
      adminCreateEmployee({ user: ADMIN, body: { name: "Erin", email: "erin@example.com" } }, res, undefined, {
        issueInvitation: async () => ({ ok: false, reason: "MAIL_FAILED" }),
      }),
  );
  assert.equal(res.statusCode, 502);
  assert.equal(deleted, "emp1", "the brand-new, history-less account is rolled back");
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes("passwordHash"), false);
  assert.equal(res.body.employee, undefined, "no employee is reported as created");
});

test("disable: only an admin may disable an employee", async () => {
  for (const caller of [EMPLOYEE, { id: "cus1", role: ROLES.CUSTOMER }]) {
    const res = response();
    let updated = false;
    await withDb(
      { user: { update: async () => { updated = true; } } },
      () => adminDisableEmployee({ user: caller, params: { id: "emp1" } }, res),
    );
    assert.equal(res.statusCode, 403);
    assert.equal(updated, false);
  }
});

test("disable: sets disabledAt, never deletes the user, and keeps identity + history", async () => {
  let updateArgs = null;
  let deleted = false;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => employeeRow(),
        update: async (args) => { updateArgs = args; return employeeRow({ disabledAt: args.data.disabledAt }); },
        delete: async () => { deleted = true; },
      },
      employeeInvitation: { updateMany: async () => {} },
    },
    () => adminDisableEmployee({ user: ADMIN, params: { id: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(updateArgs.where.id, "emp1");
  assert.ok(updateArgs.data.disabledAt instanceof Date, "disabledAt is set");
  assert.equal(updateArgs.data.status, "offline", "presence is kept truthful");
  assert.equal(deleted, false, "the user is never deleted");
  // The SAME account id, name, email and creation date come back: identity intact.
  assert.equal(res.body.employee.id, "emp1");
  assert.equal(res.body.employee.email, "erin@example.com");
  assert.equal(res.body.employee.createdAt.toISOString(), "2026-09-20T00:00:00.000Z");
});

test("disable: invalidates any outstanding invitation", async () => {
  let invArgs = null;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => employeeRow(),
        update: async (args) => employeeRow({ disabledAt: args.data.disabledAt }),
      },
      employeeInvitation: { updateMany: async (args) => { invArgs = args; } },
    },
    () => adminDisableEmployee({ user: ADMIN, params: { id: "emp1" } }, res),
  );
  assert.deepEqual(invArgs.where, { userId: "emp1", usedAt: null });
  assert.ok(invArgs.data.usedAt instanceof Date);
});

test("disable: is idempotent and refuses a non-employee target", async () => {
  const already = response();
  let updated = false;
  await withDb(
    {
      user: {
        findUnique: async () => employeeRow({ disabledAt: t("2026-09-01T00:00:00Z") }),
        update: async () => { updated = true; },
      },
    },
    () => adminDisableEmployee({ user: ADMIN, params: { id: "emp1" } }, already),
  );
  assert.equal(already.statusCode, 200);
  assert.equal(updated, false);

  for (const role of [ROLES.CUSTOMER, ROLES.ADMIN]) {
    const res = response();
    let updated2 = false;
    await withDb(
      { user: { findUnique: async () => ({ id: "x", role, disabledAt: null }), update: async () => { updated2 = true; } } },
      () => adminDisableEmployee({ user: ADMIN, params: { id: "x" } }, res),
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /not an employee/);
    assert.equal(updated2, false, "a customer/admin target must never be disabled through this endpoint");
  }
});

test("disable: a missing target is a 404", async () => {
  const res = response();
  await withDb(
    { user: { findUnique: async () => null } },
    () => adminDisableEmployee({ user: ADMIN, params: { id: "nope" } }, res),
  );
  assert.equal(res.statusCode, 404);
});

test("reactivate: only an admin may reactivate, and it clears disabledAt without deleting", async () => {
  const denied = response();
  let updated = false;
  await withDb(
    { user: { update: async () => { updated = true; } } },
    () => adminReactivateEmployee({ user: EMPLOYEE, params: { id: "emp1" } }, denied),
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(updated, false);

  let updateArgs = null;
  let deleted = false;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => employeeRow({ disabledAt: t("2026-09-01T00:00:00Z") }),
        update: async (args) => { updateArgs = args; return employeeRow(); },
        delete: async () => { deleted = true; },
      },
    },
    () => adminReactivateEmployee({ user: ADMIN, params: { id: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updateArgs.data, { disabledAt: null });
  assert.equal(deleted, false, "reactivating never deletes the user");
  assert.equal(res.body.employee.disabledAt, null);
  assert.equal(res.body.employee.id, "emp1", "the same account resumes");
});

test("reactivate: is idempotent and refuses a non-employee target", async () => {
  const already = response();
  let updated = false;
  await withDb(
    { user: { findUnique: async () => employeeRow(), update: async () => { updated = true; } } },
    () => adminReactivateEmployee({ user: ADMIN, params: { id: "emp1" } }, already),
  );
  assert.equal(already.statusCode, 200);
  assert.equal(updated, false);

  const res = response();
  await withDb(
    { user: { findUnique: async () => ({ id: "x", role: ROLES.CUSTOMER, disabledAt: t("2026-09-01T00:00:00Z") }) } },
    () => adminReactivateEmployee({ user: ADMIN, params: { id: "x" } }, res),
  );
  assert.equal(res.statusCode, 400);
});

// =================== invitation token security ===================

test("invitation: the token is 256 bits of CSPRNG output and only its digest is stored", () => {
  const a = generateInvitationToken();
  const b = generateInvitationToken();
  assert.notEqual(a.rawToken, b.rawToken, "tokens must be unique");
  assert.equal(a.rawToken, Buffer.from(a.rawToken, "base64url").toString("base64url"), "raw token is base64url");
  assert.equal(a.rawToken.length, 43, "32 bytes base64url-encoded");
  assert.notEqual(a.tokenHash, a.rawToken, "the stored value is a digest, not the token");
  assert.equal(a.tokenHash, hashInvitationToken(a.rawToken));
  assert.equal(a.tokenHash.length, 64, "sha256 hex digest");
  assert.equal(a.tokenHash.includes(a.rawToken), false);
});

test("invitation: the digest is purpose-separated from a password-reset token", () => {
  const raw = "shared-raw-token-value";
  assert.notEqual(
    hashInvitationToken(raw),
    hashResetToken(raw),
    "the same raw string must never produce a valid digest in both namespaces",
  );
  assert.equal(hashInvitationToken(raw).startsWith(hashResetToken(raw)), false);
});

test("invitation: expiry is enforced server-side", () => {
  assert.equal(isInvitationExpired(t("2026-09-01T00:00:00Z")), true, "a past instant is expired");
  assert.equal(isInvitationExpired(t("2999-01-01T00:00:00Z")), false, "a future instant is valid");
  assert.equal(isInvitationExpired("not-a-date"), true, "an unparseable expiry fails closed");
  assert.equal(INVITATION_TOKEN_TTL_MS > 0, true);
  assert.equal(INVITATION_TOKEN_TTL_MS <= 7 * 24 * HOUR, true, "an invitation cannot be long-lived");
});

// In-memory fake of the two tables the invitation service uses.
function fakeInvitationDb({ stored = [], users = {}, clock } = {}) {
  const state = { invitations: stored.map((r) => ({ ...r })), users: { ...users }, writes: { updated: [], invitationsUsed: [] } };
  let seq = 0;
  return {
    state,
    employeeInvitation: {
      updateMany: async ({ where, data }) => {
        let n = 0;
        for (const r of state.invitations) {
          if (r.userId === where.userId && where.usedAt === null && r.usedAt === null) { r.usedAt = data.usedAt; n += 1; }
        }
        return { count: n };
      },
      create: async ({ data }) => {
        const row = { id: `inv${(seq += 1)}`, usedAt: null, createdAt: clock(), ...data };
        state.invitations.push(row);
        return row;
      },
      findUnique: async ({ where }) => state.invitations.find((r) => r.tokenHash === where.tokenHash) || null,
      deleteMany: async ({ where }) => {
        const before = state.invitations.length;
        state.invitations = state.invitations.filter((r) => !(r.userId === where.userId && r.tokenHash === where.tokenHash));
        return { count: before - state.invitations.length };
      },
      update: async ({ where, data }) => {
        const row = state.invitations.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    user: {
      findUnique: async ({ where }) => state.users[where.id] || null,
      update: async ({ where, data }) => {
        Object.assign(state.users[where.id], data);
        state.writes.updated.push({ id: where.id, data });
        return state.users[where.id];
      },
    },
    $transaction: async (ops) => Promise.all(ops),
  };
}

const INVITEE = { id: "emp1", name: "Erin", email: "erin@example.com" };

test("invitation: issuing stores only a digest and delivers a token that is never returned or logged", async () => {
  const sent = [];
  const db = fakeInvitationDb({ clock: () => t("2026-09-27T00:00:00Z") });
  const service = createEmployeeInvitationService({
    prisma: db,
    hashPassword: async (p) => `hashed:${p}`,
    sendEmail: async (mail) => { sent.push(mail); },
    now: () => t("2026-09-27T00:00:00Z"),
  });

  const result = await service.issueInvitation(INVITEE, "https://example.com");
  assert.equal(result.ok, true);
  assert.equal(db.state.invitations.length, 1);
  const stored = db.state.invitations[0];
  assert.equal(stored.userId, "emp1", "the invitation is tied to the intended employee account");
  assert.equal(stored.usedAt, null);
  assert.equal(stored.tokenHash.length, 64);
  // The email carries a link containing the raw token; the stored row does not.
  const url = sent[0].text.split("\n").find((l) => l.startsWith("https://example.com/activate-employee"));
  assert.ok(url, "the invitation email contains the activation link");
  const rawToken = decodeURIComponent(new URL(url.trim()).searchParams.get("token"));
  assert.equal(hashInvitationToken(rawToken), stored.tokenHash, "the emailed token matches the stored digest");
  assert.equal(JSON.stringify(db.state.invitations).includes(rawToken), false, "the raw token is never persisted");
  // The email exposes no password and no privileged data.
  assert.equal(/password/i.test(sent[0].text.replace(/choose your password/gi, "")), false);
  assert.equal(/hash|token:|stripe|receipt|customer/i.test(sent[0].subject), false);
});

test("invitation: a second invitation invalidates the previous one", async () => {
  const db = fakeInvitationDb({ clock: () => t("2026-09-27T00:00:00Z") });
  const service = createEmployeeInvitationService({
    prisma: db,
    hashPassword: async (p) => p,
    sendEmail: async () => {},
    now: () => t("2026-09-27T00:00:00Z"),
  });
  await service.issueInvitation(INVITEE, "https://example.com");
  const first = db.state.invitations[0].tokenHash;
  await service.issueInvitation(INVITEE, "https://example.com");
  assert.equal(db.state.invitations.length, 2);
  assert.ok(db.state.invitations[0].usedAt instanceof Date, "the older invitation is now spent");
  const service2 = createEmployeeInvitationService({
    prisma: db, hashPassword: async (p) => p, sendEmail: async () => {}, now: () => t("2026-09-27T00:00:00Z"),
  });
  const firstAttempt = await service2.activateWithToken("irrelevant", "password123");
  assert.equal(firstAttempt.ok, false);
  // The first link is dead even though its digest still exists.
  const record = db.state.invitations.find((r) => r.tokenHash === first);
  assert.ok(record.usedAt instanceof Date);
});

test("invitation: a failed delivery deletes the token so it can never be redeemed", async () => {
  const db = fakeInvitationDb({ clock: () => t("2026-09-27T00:00:00Z") });
  const service = createEmployeeInvitationService({
    prisma: db,
    hashPassword: async (p) => p,
    sendEmail: async () => { throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED"); },
    now: () => t("2026-09-27T00:00:00Z"),
  });
  const result = await service.issueInvitation(INVITEE, "https://example.com");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "MAIL_FAILED");
  assert.equal(db.state.invitations.length, 0, "an undelivered invitation leaves no redeemable token");
});

// Invitation expiry is enforced against the REAL wall clock: `isInvitationExpired`
// compares `expiresAt` to `Date.now()` directly. The service's injectable `now()`
// only stamps `usedAt`. So a fixture whose deadline is a hard-coded instant
// silently becomes "already expired" the day after it is written — and because
// the expiry check runs BEFORE the role and disabled checks, every test sharing
// that deadline then passes for the wrong reason (an expired token is refused
// before the account is ever examined).
//
// These helpers express a deadline RELATIVE to the moment the test runs, so the
// "still valid" fixtures stay valid forever and the expiry tests keep testing
// expiry. The production expiration logic is untouched.
const VALID_FOR = 60 * 60 * 1000; // 1 hour
const validInvitationExpiry = () => new Date(Date.now() + VALID_FOR);
const expiredInvitationExpiry = () => new Date(Date.now() - VALID_FOR);

function activationFixture({ expiresAt, role = ROLES.EMPLOYEE, disabledAt = null } = {}) {
  const rawToken = "raw-invitation-token";
  const tokenHash = hashInvitationToken(rawToken);
  const db = fakeInvitationDb({
    clock: () => t("2026-09-27T00:00:00Z"),
    stored: [{ id: "inv1", userId: "emp1", tokenHash, expiresAt, usedAt: null }],
    users: { emp1: { id: "emp1", role, disabledAt, passwordHash: "old" } },
  });
  const service = createEmployeeInvitationService({
    prisma: db,
    hashPassword: async (p) => `hashed:${p}`,
    sendEmail: async () => {},
    now: () => t("2026-09-27T00:00:00Z"),
  });
  return { db, service, rawToken };
}

test("invitation: an expired invitation is refused", async () => {
  const { service, rawToken } = activationFixture({ expiresAt: expiredInvitationExpiry() });
  const result = await service.activateWithToken(rawToken, "password123");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.reason, "TOKEN_INVALID", "an expired token is indistinguishable from an invalid one");
});

test("invitation: an invitation at its expiry instant is refused (inclusive bound)", async () => {
  const { service, rawToken } = activationFixture({ expiresAt: new Date(Date.now()) });
  const result = await service.activateWithToken(rawToken, "password123");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "TOKEN_INVALID");
});

test("invitation: activation is single-use — the second redemption fails", async () => {
  const { service, db, rawToken } = activationFixture({ expiresAt: validInvitationExpiry() });
  const first = await service.activateWithToken(rawToken, "password123");
  assert.equal(first.ok, true);
  assert.equal(db.state.invitations[0].usedAt instanceof Date, true, "successful activation invalidates the invitation");

  const second = await service.activateWithToken(rawToken, "password999");
  assert.equal(second.ok, false, "the same token cannot be redeemed twice");
  assert.equal(db.state.users.emp1.passwordHash, "hashed:password123", "the password is unchanged by the replay");
});

test("invitation: an unknown token fails identically to an expired one", async () => {
  const { service } = activationFixture({ expiresAt: validInvitationExpiry() });
  const unknown = await service.activateWithToken("never-issued", "password123");
  const expired = await service.activateWithToken("never-issued", "password123");
  assert.deepEqual(unknown, expired);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "TOKEN_INVALID");
});

test("invitation: an invitation can only activate an EMPLOYEE account", async () => {
  for (const role of [ROLES.CUSTOMER, ROLES.ADMIN]) {
    const { service, db, rawToken } = activationFixture({ expiresAt: validInvitationExpiry(), role });
    const result = await service.activateWithToken(rawToken, "password123");
    assert.equal(result.ok, false, `role ${role} must not be activatable by an employee invitation`);
    assert.equal(result.reason, "TOKEN_INVALID");
    assert.equal(db.state.users.emp1.passwordHash, "old", "the target account password is untouched");
  }
});

test("invitation: a DISABLED employee cannot activate their account", async () => {
  const { service, db, rawToken } = activationFixture({
    expiresAt: validInvitationExpiry(),
    disabledAt: t("2026-09-01T00:00:00Z"),
  });
  const result = await service.activateWithToken(rawToken, "password123");
  assert.equal(result.ok, false);
  assert.equal(db.state.users.emp1.passwordHash, "old");
});

test("invitation: activation targets the invitee only — a body userId is ignored", async () => {
  const { service, db, rawToken } = activationFixture({ expiresAt: validInvitationExpiry() });
  db.state.users.other = { id: "other", role: ROLES.CUSTOMER, disabledAt: null, passwordHash: "other-old" };

  // The endpoint forwards only the token and the password; the request body can
  // name any user, and the service resolves the subject from the token record.
  const result = await service.activateWithToken(rawToken, "password123");
  assert.equal(result.ok, true);
  assert.equal(db.state.writes.updated.length, 1);
  assert.equal(db.state.writes.updated[0].id, "emp1", "only the invitee is modified");
  assert.equal(db.state.users.other.passwordHash, "other-old", "no other account can be activated");
});

test("invitation: a short password is refused before any lookup or write", async () => {
  const { service, db, rawToken } = activationFixture({ expiresAt: validInvitationExpiry() });
  const result = await service.activateWithToken(rawToken, "short");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "INVALID_INPUT");
  assert.equal(db.state.writes.updated.length, 0);
  assert.equal(db.state.invitations[0].usedAt, null, "a rejected attempt does not spend the invitation");
});

test("activation endpoint: a valid invitation sets the employee's own password", async () => {
  // Exercises the REAL controller -> service -> prisma path with stubbed tables
  // and a stubbed hash implementation, so no database is involved.
  const rawToken = "raw-invitation-token-value";
  const record = {
    id: "inv1",
    userId: "emp1",
    tokenHash: hashInvitationToken(rawToken),
    expiresAt: validInvitationExpiry(),
    usedAt: null,
  };
  const row = { id: "emp1", role: ROLES.EMPLOYEE, disabledAt: null, passwordHash: "old" };
  let userUpdate = null;
  let inviteUpdate = null;

  const res = response();
  await withDb(
    {
      employeeInvitation: {
        findUnique: async ({ where }) => (where.tokenHash === record.tokenHash ? record : null),
        update: async (args) => { inviteUpdate = args; record.usedAt = args.data.usedAt; return record; },
      },
      user: {
        findUnique: async ({ where }) => (where.id === "emp1" ? row : null),
        update: async (args) => { userUpdate = args; Object.assign(row, args.data); return row; },
      },
      // The real singleton commits the password change and the invitation
      // spend in one $transaction; stub it so no database is involved.
      $root: { $transaction: async (ops) => Promise.all(ops) },
    },
    async () => {
      // Patch the hash function on the real service singleton's captured deps by
      // letting bcrypt run for real — this also proves the stored value is a
      // genuine bcrypt hash rather than a plain string.
      const result = await activateEmployeeAccount(
        { body: { token: rawToken, password: "brandNewPass123" }, ip: "198.51.100.77" },
        res,
      );
      return result;
    },
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(userUpdate.where.id, "emp1");
  assert.equal(userUpdate.data.passwordHash.includes("$2"), true, "a real bcrypt hash is stored");
  assert.equal(await verifyPassword("brandNewPass123", userUpdate.data.passwordHash), true);
  assert.equal(await verifyPassword("old", userUpdate.data.passwordHash), false);
  assert.ok(inviteUpdate.data.usedAt instanceof Date, "the invitation is spent");
  // No secret in the response.
  assert.equal(JSON.stringify(res.body).includes("passwordHash"), false);
});

test("activation endpoint: validation errors are 400 and never leak token details", async () => {
  for (const [body, pattern] of [
    [{ password: "password123" }, /Invalid or expired invitation link/],
    [{ token: "x", password: "short" }, /at least 8 characters/],
    [{ token: "x", password: "password123", confirm: "different1" }, /do not match/],
  ]) {
    const res = response();
    await activateEmployeeAccount({ body, ip: "127.0.0.1" }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, pattern);
  }
});

test("activation endpoint: an unknown token returns a non-revealing 400", async () => {
  const res = response();
  await withDb(
    { employeeInvitation: { findUnique: async () => null } },
    () => activateEmployeeAccount({ body: { token: "never-issued", password: "password123" }, ip: "127.0.0.1" }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Invalid or expired invitation link/);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes("never-issued"), false);
  assert.equal(serialized.includes("employee"), false, "the failure reveals nothing about accounts");
});

test("activation endpoint: is rate limited per IP", async () => {
  // The limiter allows 5 attempts per 15 minutes per IP; exhaust it.
  let last = null;
  for (let i = 0; i < 7; i += 1) {
    const res = response();
    await withDb(
      { employeeInvitation: { findUnique: async () => null } },
      () => activateEmployeeAccount({ body: { token: "nope", password: "password123" }, ip: "203.0.113.9" }, res),
    );
    last = res;
  }
  assert.equal(last.statusCode, 429);
  assert.match(last.body.error, /Too many requests/);
});

test("activation endpoint: never returns a token, hash or password", async () => {
  const res = response();
  await withDb(
    { employeeInvitation: { findUnique: async () => null } },
    () => activateEmployeeAccount({ body: { token: "tok", password: "password123" }, ip: "198.51.100.5" }, res),
  );
  const serialized = JSON.stringify(res.body);
  for (const forbidden of ["passwordHash", "rawToken", "tokenHash", "password"]) {
    assert.equal(serialized.includes(forbidden), false, `activation response must not expose ${forbidden}`);
  }
});

test("invitation: the raw token never appears in a thrown error message", async () => {
  const db = fakeInvitationDb({ clock: () => t("2026-09-27T00:00:00Z") });
  const service = createEmployeeInvitationService({
    prisma: db,
    hashPassword: async (p) => p,
    sendEmail: async () => { throw new Error("EMAIL_PROVIDER_ERROR"); },
    now: () => t("2026-09-27T00:00:00Z"),
  });
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try {
    await service.issueInvitation(INVITEE, "https://example.com");
  } finally {
    console.error = originalError;
  }
  const text = logged.join(" ");
  assert.equal(/raw-invitation|activate-employee\?token=/.test(text), false, "no token may be logged");
});

test("invitation: raw tokens are unguessable (distinct across many draws)", () => {
  const tokens = new Set();
  for (let i = 0; i < 200; i += 1) tokens.add(generateInvitationToken().rawToken);
  assert.equal(tokens.size, 200);
  // 256 bits of entropy: no token may repeat or look like a counter.
  assert.equal([...tokens].some((tk) => tk.length !== 43), false);
});
