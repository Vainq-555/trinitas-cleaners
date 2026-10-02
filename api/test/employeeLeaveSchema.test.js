import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// EMPLOYEE LEAVE REQUESTS — schema + migration safety.
//
// This file is the audit trail for the leave feature: it proves the model is
// additive, the migration cannot destroy anything, the two leave relations are the
// SAFE ones, and — most importantly — that leave and availability remain SEPARATE
// systems rather than two writers for the same fact.

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL(
  "../prisma/migrations/20260927040000_add_employee_leave_requests/migration.sql",
  import.meta.url,
);

const schema = readFileSync(schemaPath, "utf8");
const migrationRaw = readFileSync(migrationPath, "utf8");

// SQL content with the comment header stripped, so the additive-only assertions
// inspect real statements rather than documentation (whose prose legitimately
// contains words like "DROP").
const migration = migrationRaw
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const migrationHeader = migrationRaw.split("\n").filter((l) => l.trim().startsWith("--")).join("\n");

function modelBlock(name) {
  const match = schema.match(new RegExp(`^model ${name} \\{([^]*?)^\\}`, "m"));
  assert.ok(match, `expected model ${name} to exist in schema.prisma`);
  return match[1];
}

const normalize = (line) => line.trim().replace(/\s+/g, " ");
const blockLines = (name) => modelBlock(name).split("\n").filter((l) => l.trim() !== "").map(normalize);
// Negative "must not reference X" assertions have to inspect CODE, not prose: the
// leave model documents itself by pointing at EmployeeAvailability.date, which is
// exactly the cross-reference the comments are allowed to make.
const modelCode = (name) =>
  modelBlock(name)
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l !== "")
    .join("\n");
const hasLine = (name, line) =>
  assert.ok(blockLines(name).includes(normalize(line)), `expected model ${name} to contain: ${line}`);

// ---- the model ----

test("schema: EmployeeLeaveRequest is its own model with the required fields", () => {
  hasLine("EmployeeLeaveRequest", "id         String   @id @default(cuid())");
  hasLine("EmployeeLeaveRequest", "employeeId String");
  hasLine("EmployeeLeaveRequest", "startsOn   String");
  hasLine("EmployeeLeaveRequest", "endsOn     String");
  hasLine("EmployeeLeaveRequest", 'status     String   @default("requested")');
  hasLine("EmployeeLeaveRequest", "createdAt  DateTime @default(now())");
  hasLine("EmployeeLeaveRequest", "updatedAt  DateTime @updatedAt");
});

test("schema: kind, note, decidedAt and decidedById are all NULLABLE (a bare request is valid)", () => {
  hasLine("EmployeeLeaveRequest", "kind       String?");
  hasLine("EmployeeLeaveRequest", "note       String?");
  hasLine("EmployeeLeaveRequest", "decidedAt  DateTime?");
  hasLine("EmployeeLeaveRequest", "decidedById String?");
  // The required ends of a leave range are NOT nullable: a request always has days.
  const block = blockLines("EmployeeLeaveRequest");
  assert.equal(block.some((l) => l.startsWith("startsOn String?")), false, "startsOn must be required");
  assert.equal(block.some((l) => l.startsWith("endsOn String?")), false, "endsOn must be required");
});

test("schema: a new request defaults to 'requested' and cannot default to a decision", () => {
  const status = blockLines("EmployeeLeaveRequest").find((l) => l.startsWith("status "));
  assert.match(status, /@default\("requested"\)/);
  assert.equal(/@default\("(approved|declined)"\)/.test(status), false);
});

test("schema: the two leave relations are the safe ones (CASCADE employee, SET NULL decider)", () => {
  const lines = blockLines("EmployeeLeaveRequest");
  const employee = lines.find((l) => l.startsWith("employee "));
  const decider = lines.find((l) => l.startsWith("decidedBy "));
  assert.match(employee, /@relation\("LeaveRequestEmployee"/);
  assert.match(employee, /onDelete: Cascade/);
  assert.match(decider, /\?/);
  assert.match(decider, /@relation\("LeaveRequestDecider"/);
  assert.match(decider, /onDelete: SetNull/, "removing the deciding admin must keep the decision");
  // No relation may cascade INTO work.
  const work = /BookingAssignment|Booking\b/.test(modelCode("EmployeeLeaveRequest"));
  assert.equal(work, false, "leave must not reference bookings or assignments at all");
});

test("schema: User carries both leave back-relations, with no admin-private column", () => {
  const userLines = blockLines("User");
  assert.ok(
    userLines.includes(normalize('leaveRequests    EmployeeLeaveRequest[] @relation("LeaveRequestEmployee")')),
    "expected User to reference the leave requests it owns",
  );
  assert.ok(
    userLines.includes(normalize('leaveDecisions   EmployeeLeaveRequest[] @relation("LeaveRequestDecider")')),
    "expected User to reference the leave decisions it made",
  );
});

test("schema: the indexes the server-scoped reads need exist", () => {
  const lines = blockLines("EmployeeLeaveRequest");
  assert.ok(lines.includes(normalize("@@index([employeeId, status])")), "the employee's own list needs this index");
  assert.ok(lines.includes(normalize("@@index([status])")), "the admin's pending queue needs this index");
});

test("schema: leave reuses no existing field for its own meaning", () => {
  // `status` on User is presence-only; leave status lives on the leave row, so a
  // leave decision can never flip somebody online/offline.
  const userLines = blockLines("User");
  const userStatus = userLines.find((l) => l.startsWith("status "));
  assert.match(userStatus, /@default\("offline"\)/, "User.status must remain the presence heartbeat");
  assert.equal(/leave/i.test(userStatus), false, "User.status must not be reused for leave");
  // And the leave row carries no shadow copy of the account lifecycle.
  const leave = blockLines("EmployeeLeaveRequest");
  assert.equal(leave.some((l) => l.startsWith("disabledAt")), false, "leave is not account lifecycle");
  assert.equal(leave.some((l) => l.startsWith("role ")), false, "leave does not re-store the role");
});

// ---- leave and availability must stay separate ----

test("schema: EmployeeAvailability is unchanged and still a separate system", () => {
  hasLine("EmployeeAvailability", 'kind       String   @default("available")');
  hasLine("EmployeeAvailability", "date       String");
  // The leave model must not reach into availability, and availability must not
  // reach into leave: neither is a writer for the other's fact.
  assert.equal(/EmployeeAvailability/.test(modelCode("EmployeeLeaveRequest")), false);
  assert.equal(/EmployeeLeaveRequest/.test(modelCode("EmployeeAvailability")), false);
  // The two systems hang off User as two INDEPENDENT relations, so approving leave
  // cannot reach availability through the schema at all.
  const userLines = blockLines("User");
  assert.ok(
    userLines.some((l) => /^availabilities EmployeeAvailability\[\] @relation\("AvailabilityEmployee"\)$/.test(l)),
    "the availability relation must still exist unchanged",
  );
  assert.equal(
    userLines.filter((l) => /@relation\("AvailabilityEmployee"\)/.test(l)).length,
    1,
    "availability must have exactly one owner relation",
  );
});

// ---- migration safety ----

test("migration: is additive-only — no DROP of any kind", () => {
  assert.ok(!/\bDROP\b/.test(migration), "the migration must contain no DROP statement");
  assert.ok(!/ALTER COLUMN/i.test(migration), "no column may be altered");
  assert.ok(!/UPDATE\s+"/i.test(migration), "no data rewrite of existing rows");
  assert.ok(!/DELETE FROM/i.test(migration), "no row deletion");
  assert.ok(!/RENAME/i.test(migration), "no renames");
  assert.ok(!/TRUNCATE/i.test(migration), "no truncation");
  // The header still documents the additive contract for auditors.
  assert.match(migrationHeader, /STRICTLY ADDITIVE/);
});

test("migration: creates exactly one new table and alters nothing pre-existing", () => {
  const created = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(created, ["EmployeeLeaveRequest"]);

  // Every ALTER must target the table this migration itself created, to attach its
  // own foreign keys. No pre-existing table may be touched at all.
  const altered = [...new Set([...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(altered, ["EmployeeLeaveRequest"], "no pre-existing table may be altered");
});

test("migration: the table has every required column, with the nullable ones nullable", () => {
  const block = migration.match(/CREATE TABLE "EmployeeLeaveRequest" \(([^]*?)\n\);/);
  assert.ok(block, "expected the create statement");
  const body = block[1];
  for (const column of ["id", "employeeId", "startsOn", "endsOn", "status"]) {
    assert.match(body, new RegExp(`"${column}" TEXT NOT NULL`), `${column} must be present and NOT NULL`);
  }
  for (const column of ["createdAt", "updatedAt"]) {
    assert.match(body, new RegExp(`"${column}" TIMESTAMP\\(3\\) NOT NULL`), `${column} must be present and NOT NULL`);
  }
  for (const column of ["kind", "note", "decidedAt", "decidedById"]) {
    assert.match(body, new RegExp(`"${column}" (TEXT|TIMESTAMP\\(3\\)),`), `${column} must be present and nullable`);
  }
  assert.match(body, /"status" TEXT NOT NULL DEFAULT 'requested'/);
  assert.match(body, /"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(body, /CONSTRAINT "EmployeeLeaveRequest_pkey" PRIMARY KEY \("id"\)/);
});

test("migration: creates the indexes the server-scoped reads need", () => {
  const indexes = [...migration.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "EmployeeLeaveRequest"\("([^"]+)"(?:, "([^"]+)")?\)/g)];
  const pairs = indexes.map((m) => [m[3], m[4]].filter(Boolean).join(","));
  assert.ok(pairs.includes("employeeId,status"), "the employee's own list index");
  assert.ok(pairs.includes("status"), "the admin's pending queue index");
  // A unique constraint is not added: re-requesting the same days later is
  // legitimate, so nothing here may refuse a second request.
  assert.equal(indexes.some((m) => m[1] === "UNIQUE"), false);
});

test("migration: both foreign keys target User, with the safe delete behaviour", () => {
  const fks = [...migration.matchAll(/ADD CONSTRAINT "EmployeeLeaveRequest_(\w+?)_fkey" FOREIGN KEY \("(\w+)"\) REFERENCES "User"\("id"\) ON DELETE (CASCADE|SET NULL)/g)];
  assert.equal(fks.length, 2, "expected exactly two foreign keys");
  const byColumn = Object.fromEntries(fks.map((m) => [m[2], m[3]]));
  assert.equal(byColumn.employeeId, "CASCADE", "matches ShiftRequest.employeeId");
  assert.equal(byColumn.decidedById, "SET NULL", "matches ShiftRequest.decidedById — a decision survives");
  // No foreign key may point at work.
  assert.equal(/REFERENCES "Booking(Assignment)?"/.test(migration), false);
});

test("migration: leaves every pre-existing model untouched", () => {
  for (const table of ["User", "Booking", "BookingAssignment", "EmployeeAvailability", "ShiftOffer", "ShiftRequest", "EmployeeInvitation"]) {
    assert.equal(
      new RegExp(`ALTER TABLE "${table}"`).test(migration),
      false,
      `the migration must not alter ${table}`,
    );
  }
  // The two leave back-relations on User exist in the SCHEMA, but this migration
  // must not be what changes an existing table — the relations are satisfied by the
  // new table's own foreign keys.
  assert.equal(/"User"\s*ADD COLUMN/i.test(migration), false, "no column may be added to User");
});
