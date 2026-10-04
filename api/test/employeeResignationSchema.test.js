import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// EMPLOYEE RESIGNATION REQUESTS — schema + migration safety.
//
// This file is the audit trail for the resignation feature. The model is additive,
// the migration cannot destroy anything, the three resignation relations are the
// SAFE ones, and — most importantly — that the "one open request per employee"
// rule is enforced by a PostgreSQL PARTIAL UNIQUE INDEX rather than by a plain
// UNIQUE(employeeId, status), which would wrongly forbid resigning more than once.
//
// Like employeeLeaveSchema.test.js, the migration assertions run against SQL with
// the comment header stripped, so they inspect real statements rather than
// documentation (whose prose legitimately contains words like "DROP").

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL(
  "../prisma/migrations/20260928000000_add_employee_resignation_requests/migration.sql",
  import.meta.url,
);

const schema = readFileSync(schemaPath, "utf8");
const migrationRaw = readFileSync(migrationPath, "utf8");

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
// Negative "must not contain X" assertions have to inspect CODE, not prose: this
// model documents itself by naming BookingAssignment and ContentSection in its
// comments, which is exactly the reference the comments are allowed to make.
const modelCode = (name) =>
  modelBlock(name)
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l !== "")
    .join("\n");
const hasLine = (name, line) =>
  assert.ok(blockLines(name).includes(normalize(line)), `expected model ${name} to contain: ${line}`);

const PARTIAL_INDEX_NAME = "EmployeeResignationRequest_employeeId_requested_key";
// The exact predicate the design requires: one open request per employee, and
// nothing said about decided rows.
const PARTIAL_PREDICATE = `"status" = 'requested'`;

// ---- the model ----

test("schema: EmployeeResignationRequest exists with its required fields", () => {
  hasLine("EmployeeResignationRequest", "id         String   @id @default(cuid())");
  hasLine("EmployeeResignationRequest", "employeeId String");
  hasLine("EmployeeResignationRequest", "note       String?");
  hasLine("EmployeeResignationRequest", 'status     String   @default("requested")');
  hasLine("EmployeeResignationRequest", "createdAt DateTime @default(now())");
  hasLine("EmployeeResignationRequest", "updatedAt DateTime @updatedAt");
});

test("schema: every decision and orphan-audit field is NULLABLE", () => {
  for (const field of [
    "decidedAt",
    "decidedById",
    "orphanedAssignmentCount",
    "orphanReason",
    "orphanAcknowledgedAt",
    "orphanAcknowledgedById",
  ]) {
    assert.ok(
      blockLines("EmployeeResignationRequest").some((l) => l.startsWith(`${field} `) && l.includes("?")),
      `${field} must be nullable — an undecided request has none of them`,
    );
  }
});

test("schema: note is nullable and employeeId is required", () => {
  const lines = blockLines("EmployeeResignationRequest");
  // A resignation needs no note; absence of one is never a reason to refuse it.
  assert.ok(lines.includes(normalize("note       String?")), "note must be nullable");
  // But it always belongs to exactly one employee.
  assert.equal(
    lines.some((l) => l.startsWith("employeeId String?")),
    false,
    "employeeId must be required",
  );
  assert.ok(lines.includes(normalize("employeeId String")));
});

test("schema: orphanedAssignmentCount is an Int (a count, never a relation)", () => {
  hasLine("EmployeeResignationRequest", "orphanedAssignmentCount Int?");
});

test("schema: status defaults to 'requested' and cannot default to a decision", () => {
  const status = blockLines("EmployeeResignationRequest").find((l) => l.startsWith("status "));
  assert.match(status, /String/);
  assert.match(status, /@default\("requested"\)/);
  // Exactly three states exist; there is deliberately no fourth status for an
  // orphan acknowledgement, so no other value may become a default.
  assert.equal(/@default\("(approved|declined)"\)/.test(status), false);
  assert.equal(/resignationStatus/i.test(schema), false, "status is a bare String, validated in config.js");
});

test("schema: the employee relation CASCADEs", () => {
  const employee = blockLines("EmployeeResignationRequest").find((l) => l.startsWith("employee "));
  assert.match(employee, /^employee User @relation\(/, "the forward relation must point at User");
  assert.match(employee, /@relation\("ResignationRequestEmployee"/);
  assert.match(employee, /fields: \[employeeId\]/);
  assert.match(employee, /references: \[id\]/);
  assert.match(employee, /onDelete: Cascade/, "matches EmployeeLeaveRequest.employeeId");
});

test("schema: the decider relation is optional and SETS NULL", () => {
  const decider = blockLines("EmployeeResignationRequest").find((l) => l.startsWith("decidedBy "));
  assert.match(decider, /\?/, "a request is created before any admin decides it");
  assert.match(decider, /User\?/);
  assert.match(decider, /@relation\("ResignationRequestDecider"/);
  assert.match(decider, /fields: \[decidedById\]/);
  assert.match(decider, /onDelete: SetNull/, "removing the deciding admin must keep the decision");
});

test("schema: the orphan acknowledger relation is optional and SETS NULL", () => {
  const line = blockLines("EmployeeResignationRequest").find((l) => l.startsWith("orphanAcknowledgedBy "));
  assert.ok(line, "expected an orphanAcknowledgedBy relation");
  assert.match(line, /\?/, "an ordinary approval has no acknowledgement");
  assert.match(line, /User\?/);
  assert.match(line, /@relation\("ResignationRequestOrphanAcknowledger"/);
  assert.match(line, /fields: \[orphanAcknowledgedById\]/);
  assert.match(line, /references: \[id\]/);
  assert.match(line, /onDelete: SetNull/, "an irreversible override must survive losing its actor");
});

test("schema: no relation points at work — only the count is stored", () => {
  // BookingAssignment remains the sole source of truth for real work. The
  // resignation row records HOW MANY assignments were orphaned, never which ones.
  const code = modelCode("EmployeeResignationRequest");
  assert.equal(/BookingAssignment/.test(code), false, "no relation to BookingAssignment");
  assert.equal(/\bBooking\b/.test(code), false, "no relation to Booking");
  assert.equal(/bookings?\s+Booking/.test(code), false);
});

test("schema: resignation does not shadow the account lifecycle or the role", () => {
  const lines = blockLines("EmployeeResignationRequest");
  // Finalization changes User.role, and does NOT set disabledAt, so the row must
  // not re-store either as its own copy.
  assert.equal(lines.some((l) => l.startsWith("disabledAt")), false, "resignation is not account disabling");
  assert.equal(lines.some((l) => l.startsWith("role ")), false, "the role lives on User only");
  // And it is not leave: two separate systems with two separate tables.
  assert.equal(/EmployeeLeaveRequest/.test(modelCode("EmployeeResignationRequest")), false);
  assert.equal(/EmployeeResignationRequest/.test(modelCode("EmployeeLeaveRequest")), false);
});

test("schema: no resignedAt / resignedById, no requestedEffectiveOn, no declineReason", () => {
  const lines = blockLines("EmployeeResignationRequest");
  // The row IS the audit record, so no denormalized copy is needed on it...
  for (const field of ["resignedAt", "resignedById"]) {
    assert.equal(lines.some((l) => l.startsWith(field)), false, `${field} must not exist on the request`);
  }
  // ...and none on User either.
  const user = blockLines("User");
  for (const field of ["resignedAt", "resignedById"]) {
    assert.equal(user.some((l) => l.startsWith(field)), false, `${field} must not be added to User`);
  }
  // Approval is IMMEDIATE, so there is no future effective date to record.
  assert.equal(lines.some((l) => l.startsWith("requestedEffectiveOn")), false);
  // No decline reason was approved for this step.
  assert.equal(lines.some((l) => l.startsWith("declineReason")), false);
});

test("schema: User carries all three resignation back-relations", () => {
  const user = blockLines("User");
  for (const [field, relation] of [
    ["resignationRequestsAsEmployee", "ResignationRequestEmployee"],
    ["resignationRequestsAsDecider", "ResignationRequestDecider"],
    ["resignationRequestsAsOrphanAcknowledger", "ResignationRequestOrphanAcknowledger"],
  ]) {
    assert.ok(
      user.includes(normalize(`${field} EmployeeResignationRequest[] @relation("${relation}")`)),
      `expected User.${field} to reference "${relation}"`,
    );
  }
  // Each relation name must resolve on BOTH sides, so it appears exactly twice.
  for (const relation of [
    "ResignationRequestEmployee",
    "ResignationRequestDecider",
    "ResignationRequestOrphanAcknowledger",
  ]) {
    assert.equal(
      (schema.match(new RegExp(`@relation\\("${relation}"`, "g")) || []).length,
      2,
      `"${relation}" must be declared once here and once on User`,
    );
  }
});

test("schema: the indexes the server-scoped reads need exist", () => {
  const lines = blockLines("EmployeeResignationRequest");
  assert.ok(lines.includes(normalize("@@index([employeeId, status])")), "the employee's own list needs this index");
  assert.ok(lines.includes(normalize("@@index([status])")), "the admin's pending queue needs this index");
});

test("schema: there is NO @@unique([employeeId, status]) and no @@unique at all", () => {
  // Checked against COMMENT-STRIPPED code: this model documents itself by writing
  // the forbidden constraint out in a comment, and prose must not count as a
  // constraint.
  const code = modelCode("EmployeeResignationRequest");
  // This is the whole point of the partial index. A plain UNIQUE(employeeId,
  // status) would permit only one 'approved' row per employee for the rest of
  // time, so somebody who resigned once could never resign again, and repeated
  // declines would collide. Historical rows must coexist freely.
  assert.equal(
    /@@unique/.test(code),
    false,
    "a plain @@unique([employeeId, status]) would forbid resigning more than once",
  );
  assert.equal(
    code.split("\n").some((l) => l.trim().startsWith("@@unique")),
    false,
    "uniqueness is enforced by the migration's partial index, not by any @@unique",
  );
  // The two plain indexes that DO exist must not be unique either.
  const lines = blockLines("EmployeeResignationRequest").filter((l) => l.startsWith("@@index"));
  assert.equal(lines.length, 2);
  assert.equal(lines.some((l) => l.includes("unique")), false);
});

test("schema: the partial index is documented in the model but NOT expressed in Prisma", () => {
  // Prisma 5.22 cannot model a partial index, so the predicate lives only in
  // migration SQL. The model must say so, so the next reader does not "fix" it by
  // adding an @@unique. This mirrors ContentSection's established pattern.
  assert.ok(
    /PARTIAL UNIQUE INDEX/.test(modelBlock("EmployeeResignationRequest")),
    "the model must document that the guard is a partial unique index",
  );
  // No Prisma attribute anywhere in this model may encode a WHERE predicate: the
  // predicate must be MIGRATION SQL only. (Checked on comment-stripped code,
  // because documenting the predicate in a comment is expected and required.)
  assert.equal(
    /WHERE/i.test(modelCode("EmployeeResignationRequest")),
    false,
    "Prisma cannot express a partial index; the SQL is authoritative",
  );
});

// ---- migration safety ----

test("migration: is additive-only — no destructive statement of any kind", () => {
  assert.ok(!/\bDROP\b/.test(migration), "the migration must contain no DROP statement");
  assert.ok(!/ALTER COLUMN/i.test(migration), "no column may be altered");
  assert.ok(!/\bUPDATE\s+"/i.test(migration), "no data rewrite of existing rows");
  assert.ok(!/DELETE FROM/i.test(migration), "no row deletion");
  assert.ok(!/INSERT INTO/i.test(migration), "no data seeding");
  assert.ok(!/RENAME/i.test(migration), "no renames");
  assert.ok(!/TRUNCATE/i.test(migration), "no truncation");
  // The header still documents the additive contract for auditors.
  assert.match(migrationHeader, /STRICTLY ADDITIVE/);
});

test("migration: creates exactly one new table and alters nothing pre-existing", () => {
  const created = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(created, ["EmployeeResignationRequest"]);

  // Every ALTER must target the table this migration itself created, to attach its
  // own foreign keys. No pre-existing table may be touched at all.
  const altered = [...new Set([...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(altered, ["EmployeeResignationRequest"], "no pre-existing table may be altered");
});

test("migration: adds nothing to User", () => {
  // The three resignation back-relations are Prisma declarations satisfied by the
  // new table's own foreign keys, so "User" must appear only as an FK target.
  assert.equal(/"User"\s*ADD COLUMN/i.test(migration), false, "no column may be added to User");
  assert.equal(/ALTER TABLE "User"/i.test(migration), false, "User must never be altered");
  assert.equal(/CREATE INDEX[^;]*ON "User"/i.test(migration), false, "no index may be added to User");
  assert.equal(/CREATE UNIQUE INDEX[^;]*ON "User"/i.test(migration), false, "no unique index on User");
  assert.match(migration, /REFERENCES "User"\("id"\)/, "User is still referenced, as an FK target");
});

test("migration: leaves every pre-existing model untouched", () => {
  for (const table of [
    "User",
    "Booking",
    "BookingAssignment",
    "EmployeeLeaveRequest",
    "EmployeeAvailability",
    "ShiftOffer",
    "ShiftRequest",
    "EmployeeInvitation",
    "EmployeeCommunity",
  ]) {
    assert.equal(
      new RegExp(`ALTER TABLE "${table}"`).test(migration),
      false,
      `the migration must not alter ${table}`,
    );
    assert.equal(
      new RegExp(`CREATE (UNIQUE )?INDEX[^;]*ON "${table}"`).test(migration),
      false,
      `the migration must not add an index to ${table}`,
    );
  }
  // Nothing at all may target existing work or leave.
  assert.equal(/"BookingAssignment"\s*\(/i.test(migration), false);
  assert.equal(/EmployeeLeaveRequest/i.test(migration), false, "leave must be entirely untouched");
});

test("migration: the table has every required column, with the nullable ones nullable", () => {
  const block = migration.match(/CREATE TABLE "EmployeeResignationRequest" \(([^]*?)\n\);/);
  assert.ok(block, "expected the create statement");
  const body = block[1];

  for (const column of ["id", "employeeId"]) {
    assert.match(body, new RegExp(`"${column}" TEXT NOT NULL`), `${column} must be present and NOT NULL`);
  }
  for (const column of ["createdAt", "updatedAt"]) {
    assert.match(body, new RegExp(`"${column}" TIMESTAMP\\(3\\) NOT NULL`), `${column} must be present and NOT NULL`);
  }
  for (const column of ["note", "decidedById", "orphanReason", "orphanAcknowledgedById"]) {
    assert.match(body, new RegExp(`"${column}" TEXT,`), `${column} must be present and nullable`);
  }
  for (const column of ["decidedAt", "orphanAcknowledgedAt"]) {
    assert.match(body, new RegExp(`"${column}" TIMESTAMP\\(3\\),`), `${column} must be present and nullable`);
  }
  // The orphan COUNT is a nullable integer, never text.
  assert.match(body, /"orphanedAssignmentCount" INTEGER,/);

  assert.match(body, /"status" TEXT NOT NULL DEFAULT 'requested'/);
  assert.match(body, /"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(body, /CONSTRAINT "EmployeeResignationRequest_pkey" PRIMARY KEY \("id"\)/);
});

test("migration: creates the two indexes the server-scoped reads need", () => {
  // \s+ before ON, because the partial unique index is written across two lines.
  const indexes = [
    ...migration.matchAll(
      /CREATE (UNIQUE )?INDEX "([^"]+)"\s+ON "EmployeeResignationRequest"\("([^"]+)"(?:, "([^"]+)")?\)/g,
    ),
  ];
  const pairs = indexes.map((m) => [m[3], m[4]].filter(Boolean).join(","));
  assert.ok(pairs.includes("employeeId,status"), "the employee's own list index");
  assert.ok(pairs.includes("status"), "the admin's pending queue index");
  // NOTE: capture group 1 is "UNIQUE " WITH a trailing space, because it comes
  // from the pattern `CREATE (UNIQUE )?INDEX`.
  assert.ok(
    indexes.some((m) => (m[1] || "").trim() === "UNIQUE"),
    "the requested-only unique index must be present",
  );
  // The two plain server-scoped indexes must NOT be unique.
  assert.equal(indexes.filter((m) => (m[1] || "").trim() !== "UNIQUE").length, 2);
});

test("migration: the one-open-request guard is a PARTIAL unique index on employeeId", () => {
  const statement = migration.match(new RegExp(`CREATE UNIQUE INDEX "${PARTIAL_INDEX_NAME}"[^;]+;`));
  assert.ok(statement, `expected CREATE UNIQUE INDEX "${PARTIAL_INDEX_NAME}"`);
  const sql = statement[0];

  // It must be partial, and its ON list must be exactly (employeeId).
  const on = sql.match(/ON "EmployeeResignationRequest"\(([^)]*)\)/);
  assert.ok(on, "expected an ON clause against the new table");
  assert.equal(on[1].trim(), '"employeeId"', "the guard must key on employeeId alone");
  assert.ok(/\sWHERE\b/.test(sql), "the index must be partial: it must carry a WHERE predicate");
});

test("migration: the partial predicate is exactly status = 'requested'", () => {
  const statement = migration.match(new RegExp(`CREATE UNIQUE INDEX "${PARTIAL_INDEX_NAME}"[^;]+;`));
  const where = statement[0].match(/WHERE\s+([^;]+);/);
  assert.ok(where, "expected a WHERE predicate");
  assert.equal(where[1].trim().replace(/\s+/g, " "), PARTIAL_PREDICATE);
});

test("migration: the predicate is never a generic condition that would freeze history", () => {
  const statement = migration.match(new RegExp(`CREATE UNIQUE INDEX "${PARTIAL_INDEX_NAME}"[^;]+;`));
  const sql = statement[0];
  // WHERE status IS NOT NULL would also cover every DECIDED row, so it would
  // forbid a second resignation after the first approval, and would forbid any
  // second request after a single decline — destroying the history this table
  // exists to keep. Only the open 'requested' state may be constrained.
  assert.equal(/IS NOT NULL/i.test(sql), false, "a generic IS NOT NULL predicate would freeze history");
  assert.equal(/IS\s+NULL/i.test(sql), false);
  assert.equal(/status\s*<>|status\s*!=/i.test(sql), false, "the predicate must be positive equality");
  assert.equal(/decidedAt|createdAt|updatedAt/.test(sql), false, "the predicate must key on status only");
});

test("migration: all three foreign keys target User, with the safe delete behaviour", () => {
  const fks = [
    ...migration.matchAll(
      /ADD CONSTRAINT "EmployeeResignationRequest_(\w+?)_fkey" FOREIGN KEY \("(\w+)"\) REFERENCES "User"\("id"\) ON DELETE (CASCADE|SET NULL)/g,
    ),
  ];
  assert.equal(fks.length, 3, "expected exactly three foreign keys");
  const byColumn = Object.fromEntries(fks.map((m) => [m[2], m[3]]));
  assert.equal(byColumn.employeeId, "CASCADE", "matches EmployeeLeaveRequest.employeeId");
  assert.equal(byColumn.decidedById, "SET NULL", "a decision survives its admin");
  assert.equal(byColumn.orphanAcknowledgedById, "SET NULL", "an override survives losing its actor");
});

test("migration: no foreign key points at work", () => {
  assert.equal(/REFERENCES "Booking(Assignment)?"/.test(migration), false);
  assert.equal(/REFERENCES "EmployeeLeaveRequest"/.test(migration), false);
  // Every reference in the file must be to User and nothing else.
  const targets = [...new Set([...migration.matchAll(/REFERENCES "([^"]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(targets, ["User"], "User is the only referenced table");
});

// ---- pre-existing schema must remain untouched ----

test("schema: EmployeeLeaveRequest remains exactly as it was", () => {
  hasLine("EmployeeLeaveRequest", "startsOn   String");
  hasLine("EmployeeLeaveRequest", "endsOn     String");
  hasLine("EmployeeLeaveRequest", 'status     String   @default("requested")');
  const lines = blockLines("EmployeeLeaveRequest");
  assert.ok(lines.includes(normalize('employee   User     @relation("LeaveRequestEmployee", fields: [employeeId], references: [id], onDelete: Cascade)')));
  assert.ok(lines.includes(normalize('decidedBy  User?    @relation("LeaveRequestDecider", fields: [decidedById], references: [id], onDelete: SetNull)')));
  assert.ok(lines.includes(normalize("@@index([employeeId, status])")));
  assert.ok(lines.includes(normalize("@@index([status])")));
  // Leave gained no resignation relation, and resignation gained none of leave's.
  assert.equal(/resignation/i.test(modelCode("EmployeeLeaveRequest")), false);
});

test("schema: User's scalar columns are unchanged", () => {
  const user = blockLines("User");
  // Presence stays presence-only, and the account lifecycle keeps its own field.
  // These lines carry explanatory `//` comments, so they are matched by shape
  // rather than by exact normalized equality.
  assert.match(user.find((l) => l.startsWith("status ")), /String\s+@default\("offline"\)/);
  assert.match(user.find((l) => l.startsWith("role ")), /String\s+@default\("customer"\)/);
  assert.ok(user.some((l) => l.startsWith("disabledAt DateTime?")));
  assert.ok(user.some((l) => l.startsWith("lastActiveAt DateTime?")));
  assert.match(user.find((l) => l.startsWith("createdAt ")), /DateTime\s+@default\(now\(\)\)/);
  assert.ok(user.some((l) => l.startsWith("communityBlockedAt DateTime?")));
  assert.ok(user.includes(normalize("stripeCustomerId String? @unique")));
  assert.ok(user.includes(normalize("@@index([role])")));
  // Resignation adds back-relations only — no scalar column whatsoever. Checked
  // against comment-stripped code, because documenting the absence of
  // resignedAt/resignedById in a comment is exactly what should happen.
  const userCode = modelCode("User");
  assert.equal(/resigned/i.test(userCode), false, "no resigned* column may exist on User");
  assert.equal(/requestedEffectiveOn|declineReason/.test(userCode), false);
  assert.equal(
    user.filter((l) => l.startsWith("resignationRequests")).length,
    3,
    "exactly three back-relations",
  );
});
