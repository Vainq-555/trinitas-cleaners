import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL(
  "../prisma/migrations/20260927000000_add_employee_accounts_and_assignments/migration.sql",
  import.meta.url,
);

const schema = readFileSync(schemaPath, "utf8");
const migrationRaw = readFileSync(migrationPath, "utf8");

// SQL-content view with the explanatory comment header stripped, so every
// additive-only assertion below inspects real statements rather than the
// documentation (whose prose legitimately contains words like "DROP").
const migration = migrationRaw
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

// The header must still document the additive contract for auditors.
const migrationHeader = migrationRaw.split("\n").filter((l) => l.trim().startsWith("--")).join("\n");

function modelBlock(name) {
  const match = schema.match(new RegExp(`^model ${name} \\{([^]*?)^\\}`, "m"));
  assert.ok(match, `expected model ${name} to exist in schema.prisma`);
  return match[1];
}

const normalize = (line) => line.trim().replace(/\s+/g, " ");
const blockLines = (name) => modelBlock(name).split("\n").filter((l) => l.trim() !== "").map(normalize);
const hasLine = (name, line) =>
  assert.ok(blockLines(name).includes(normalize(line)), `expected model ${name} to contain: ${line}`);

// ---- User: additive account lifecycle ----

test("schema: User gains a nullable disabledAt (additive, NOT NULL never used)", () => {
  hasLine("User", "disabledAt DateTime?");
  const userBlock = modelBlock("User");
  assert.equal(/^\s*disabledAt\s+DateTime\s*$/m.test(userBlock), false, "disabledAt must be nullable");
});

test("schema: User.status is still presence-only and NOT reused for account activation", () => {
  hasLine("User", 'status       String    @default("offline") // "online" | "offline"');
  hasLine("User", "lastActiveAt DateTime?");
  // The lifecycle field is a separate column, so status keeps its own meaning.
  assert.equal(blockLines("User").some((l) => l.startsWith("disabledAt")), true);
});

test("schema: User carries the three employee back-relations with named assignment relations", () => {
  hasLine("User", "employeeInvitations EmployeeInvitation[]");
  hasLine("User", 'employeeAssignments BookingAssignment[] @relation("AssignedEmployee")');
  hasLine("User", 'assignmentsMade BookingAssignment[] @relation("AssignedBy")');
});

// ---- BookingAssignment ----

test("schema: BookingAssignment exists with the required fields", () => {
  for (const line of [
    "id String @id @default(cuid())",
    "bookingId String @unique",
    "employeeId String?",
    "assignedById String?",
    "assignedAt DateTime @default(now())",
    "scheduledStartAt DateTime?",
    "visibleToEmployee Boolean @default(true)",
    "createdAt DateTime @default(now())",
    "updatedAt DateTime @updatedAt",
  ]) {
    hasLine("BookingAssignment", line);
  }
});

test("schema: BookingAssignment uses safe (SetNull) employee/assigner deletion, never a destructive cascade", () => {
  for (const line of [
    'employee User? @relation("AssignedEmployee", fields: [employeeId], references: [id], onDelete: SetNull)',
    'assignedBy User? @relation("AssignedBy", fields: [assignedById], references: [id], onDelete: SetNull)',
  ]) {
    hasLine("BookingAssignment", line);
  }
  // The employee and assignedBy columns MUST be optional for SetNull to be valid.
  hasLine("BookingAssignment", "employeeId String?");
  hasLine("BookingAssignment", "assignedById String?");
  // A booking-scoped cascade is allowed (it only ever removes the assignment row).
  hasLine("BookingAssignment", 'booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)');
  // No other destructive action may appear.
  const bookingAssignment = modelBlock("BookingAssignment");
  assert.equal(/onDelete: Cascade\s*\n\s*\n\s*employee/.test(bookingAssignment), false);
  assert.equal(blockLines("BookingAssignment").filter((l) => l.includes("onDelete:")).length, 3);
});

test("schema: BookingAssignment has the indexes the server-scoped reads need", () => {
  hasLine("BookingAssignment", "@@index([employeeId])");
  hasLine("BookingAssignment", "@@index([assignedById])");
  assert.ok(blockLines("BookingAssignment").includes(normalize("bookingId String @unique")), "one assigned employee per booking");
});

test("schema: Booking keeps its customer relation untouched and gains only a back-relation", () => {
  // The customer relationship is byte-for-byte the original.
  hasLine("Booking", "customerId      String");
  hasLine("Booking", "customer User     @relation(fields: [customerId], references: [id], onDelete: Cascade)");
  // The customer's own requested schedule is still a nullable Booking column.
  hasLine("Booking", "scheduledStartAt               DateTime?");
  // No employee field is ever placed ON the booking.
  const bookingBlock = modelBlock("Booking");
  assert.equal(/^\s*employeeId\s/m.test(bookingBlock), false, "Booking must not gain an employeeId column");
  assert.equal(/employee\s+User/.test(bookingBlock), false, "Booking must not gain an employee relation column");
  hasLine("Booking", "employeeAssignments BookingAssignment[]");
});

test("schema: the booking customer index and status index still exist", () => {
  hasLine("Booking", "@@index([customerId])");
  hasLine("Booking", "@@index([status])");
});

// ---- EmployeeInvitation ----

test("schema: EmployeeInvitation is a dedicated single-use expiring token model", () => {
  for (const line of [
    "id String @id @default(cuid())",
    "userId String",
    "tokenHash String   @unique",
    "expiresAt DateTime",
    "usedAt    DateTime?",
    "createdAt DateTime @default(now())",
    "user User @relation(fields: [userId], references: [id], onDelete: Cascade)",
    "@@index([userId])",
    "@@index([expiresAt])",
  ]) {
    hasLine("EmployeeInvitation", line);
  }
});

test("schema: the invitation is a SEPARATE model and SEPARATE table from PasswordResetToken", () => {
  // Both models are deliberately similar in shape, so the separation is NOT
  // structural: an invitation is never stored in the password-reset table, and
  // the two digests are purpose-prefixed so a token from one namespace can never
  // be redeemed in the other (asserted in employeeAdmin.test.js).
  assert.ok(modelBlock("EmployeeInvitation"), "EmployeeInvitation is its own model");
  assert.ok(modelBlock("PasswordResetToken"), "PasswordResetToken still exists unchanged");
  assert.notEqual(
    /model EmployeeInvitation\b/.test(schema) && /model PasswordResetToken\b/.test(schema),
    false,
    "both models must be declared separately",
  );
  // The invitation is not a column or relation on the reset model.
  assert.equal(modelBlock("PasswordResetToken").includes("Invitation"), false);
  assert.equal(modelBlock("EmployeeInvitation").includes("PasswordReset"), false);
  // PasswordResetToken itself is unchanged.
  hasLine("PasswordResetToken", "usedAt    DateTime?");
  hasLine("PasswordResetToken", "tokenHash String   @unique");
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

test("migration: the only ALTER of a pre-existing table is one nullable ADD COLUMN on User", () => {
  const alters = [...migration.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN\s+"([^"]+)"\s+([^;]+);/g)];
  const userColumnAlters = alters.filter((m) => m[1] === "User");
  assert.equal(userColumnAlters.length, 1, "exactly one column is added to an existing table");
  assert.equal(userColumnAlters[0][2], "disabledAt");
  assert.match(userColumnAlters[0][3], /^TIMESTAMP\(3\)$/);
  assert.equal(userColumnAlters[0][3].includes("NOT NULL"), false, "the new column must be nullable so existing rows stay valid");
  // No pre-existing table has any other column added or changed.
  const otherAlters = [...migration.matchAll(/ALTER TABLE "([^"]+)"(?! ADD COLUMN)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(otherAlters)].filter((t) => t !== "EmployeeInvitation" && t !== "BookingAssignment"), []);
});

test("migration: creates exactly the two new tables", () => {
  const created = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), ["BookingAssignment", "EmployeeInvitation"]);
});

test("migration: creates the indexes the server-scoped employee reads rely on", () => {
  for (const index of [
    '"EmployeeInvitation_tokenHash_key"',
    '"EmployeeInvitation_userId_idx"',
    '"EmployeeInvitation_expiresAt_idx"',
    '"BookingAssignment_bookingId_key"',
    '"BookingAssignment_employeeId_idx"',
    '"BookingAssignment_assignedById_idx"',
  ]) {
    assert.ok(migration.includes(`CREATE`), "index statements are present");
    assert.ok(migration.includes(index) || migration.includes(index.split('"')[1]), `expected index ${index}`);
  }
  assert.ok(/CREATE UNIQUE INDEX "EmployeeInvitation_tokenHash_key" ON "EmployeeInvitation"\("tokenHash"\);/.test(migration));
  assert.ok(/CREATE UNIQUE INDEX "BookingAssignment_bookingId_key" ON "BookingAssignment"\("bookingId"\);/.test(migration));
  assert.ok(/CREATE INDEX "BookingAssignment_employeeId_idx" ON "BookingAssignment"\("employeeId"\);/.test(migration));
});

test("migration: employee and assigning-admin foreign keys are ON DELETE SET NULL (no destructive cascade)", () => {
  assert.ok(
    /ALTER TABLE "BookingAssignment" ADD CONSTRAINT "BookingAssignment_employeeId_fkey" FOREIGN KEY \("employeeId"\) REFERENCES "User"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE;/.test(migration),
    "an employee can never cascade away an assignment or a booking",
  );
  assert.ok(
    /ALTER TABLE "BookingAssignment" ADD CONSTRAINT "BookingAssignment_assignedById_fkey" FOREIGN KEY \("assignedById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE;/.test(migration),
    "removing the assigning admin keeps the assignment",
  );
  // No destructive cascade is ever aimed at Booking, Receipt, Customer or Payment.
  const destructive = [...migration.matchAll(/ON DELETE (CASCADE|RESTRICT|NO ACTION)/g)];
  assert.equal(destructive.length, 2, "only the booking-scoped and invitation-scoped cascades exist");
  const cascadeLines = migration.split("\n").filter((l) => l.includes("ON DELETE CASCADE"));
  assert.equal(cascadeLines.length, 2);
  assert.ok(cascadeLines[0].includes('"EmployeeInvitation_userId_fkey"'));
  assert.ok(cascadeLines[1].includes('"BookingAssignment_bookingId_fkey"'));
});

test("migration: never references a Receipt, Payment, Customer table or a price/tax column", () => {
  for (const table of ['"Receipt"', '"Payment"', '"Customer"']) {
    assert.equal(migration.includes(table), false, `the migration must not touch ${table}`);
  }
  for (const column of ["price", "Tax", "tax", "amount", "total", "customerId", "promotionId", "discount"]) {
    assert.equal(migration.includes(column), false, `the migration must not reference ${column}`);
  }
});

test("migration: Booking.customerId and Booking.scheduledStartAt are untouched by the migration", () => {
  // The only statement mentioning the Booking table is the FK to its id.
  const bookingStatements = migration.split("\n").filter((l) => l.includes('"Booking"'));
  assert.equal(bookingStatements.length, 1);
  assert.ok(bookingStatements[0].includes('REFERENCES "Booking"("id")'));
  assert.equal(bookingStatements[0].includes("customerId"), false);
  assert.equal(bookingStatements[0].includes("scheduledStartAt"), false);
});

// ---- global invariants ----

test("schema: no native enum was introduced (roles stay app-validated strings)", () => {
  assert.equal(/^enum\s+\w+/m.test(schema), false, "schema must not declare a Prisma/PostgreSQL enum");
});

test("schema: the pre-existing models this phase must not touch are unchanged in shape", () => {
  // Guard the load-bearing customer/financial models against accidental edits.
  assert.ok(modelBlock("Receipt").includes('customer User     @relation(fields: [customerId], references: [id], onDelete: Cascade)'));
  assert.ok(modelBlock("Payment").includes('booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)'));
  hasLine("PasswordResetToken", "tokenHash String   @unique");
  hasLine("Service", "id          String   @id @default(cuid())");
});

test("schema: the employee role is a plain string value, not a hierarchy or a new table", () => {
  hasLine("User", 'role         String    @default("customer") // "admin" | "customer" | "employee" (no hierarchy)');
  assert.equal(/model Role\b/.test(schema), false, "no role hierarchy table may exist");
});
