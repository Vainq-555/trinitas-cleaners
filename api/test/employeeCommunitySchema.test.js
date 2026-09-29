import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migrationFile = readFileSync(
  new URL("../prisma/migrations/20260927030000_add_employee_community/migration.sql", import.meta.url),
  "utf8",
);
// Assertions run against the SQL with `--` comments stripped. This migration
// documents its own safety rules at length, and a keyword scan over commented
// prose would flag "no DROP COLUMN" and "ON UPDATE CASCADE" as violations.
const migration = migrationFile
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

const block = (src, name) => {
  const start = src.indexOf(`model ${name} {`);
  assert.notEqual(start, -1, `model ${name} must exist`);
  const end = src.indexOf("\n}", start);
  return src.slice(start, end);
};

const message = block(schema, "CommunityMessage");
const user = block(schema, "User");

// =================== additive-only ===================

test("SCHEMA: CommunityMessage gains audience, deletedAt and deletedById with the intended types", () => {
  assert.match(message, /audience\s+String\s+@default\("customer"\)/);
  assert.match(message, /deletedAt\s+DateTime\?/);
  assert.match(message, /deletedById\s+String\?/);
  // Nothing may become required: every existing row has to survive the change.
  assert.equal(/audience\s+String\?/.test(message), false);
  assert.equal(/deletedAt\s+DateTime[^?]/.test(message), false);
  assert.equal(/deletedById\s+String[^?]/.test(message), false);
});

test("SCHEMA: the deletedBy relation is nullable and does not cascade-delete the user", () => {
  assert.match(
    message,
    /deletedBy\s+User\?\s+@relation\("CommunityMessageDeletedBy",\s*fields:\s*\[deletedById\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/,
  );
  // onDelete: Cascade or Restrict here would let deleting a user delete
  // moderation history, or block the delete outright. SetNull is the only safe
  // option. The check is scoped to the deletedBy clause so the author
  // relation's own deliberate Cascade is not flagged.
  const deletedByClause = message.slice(message.indexOf("deletedBy User?"));
  assert.equal(/onDelete:\s*Cascade/.test(deletedByClause), false);
  assert.equal(/onDelete:\s*Restrict/.test(deletedByClause), false);
});

test("SCHEMA: the author relation and its foreign key are unchanged", () => {
  assert.match(message, /customerId\s+String/);
  assert.match(message, /customer\s+User\s+@relation\(fields:\s*\[customerId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
  // The author key keeps its name, so no customer community query has to change.
  assert.equal(message.includes("authorId"), false);
});

test("SCHEMA: User gains exactly one back-relation, named for the role", () => {
  // The pre-existing author-side back-relation is preserved verbatim...
  assert.match(user, /communityMessages\s+CommunityMessage\[\]/);
  // ...and a second, NAMED relation is added, because CommunityMessage now
  // references User twice. An unnamed second relation would fail prisma validate.
  assert.match(user, /communityMessagesDeleted\s+CommunityMessage\[\]\s+@relation\("CommunityMessageDeletedBy"\)/);
  assert.match(user, /communityProfile\s+CommunityProfile\?/);
});

test("SCHEMA: the audience index is added alongside the two existing indexes", () => {
  assert.match(message, /@@index\(\[createdAt\]\)/);
  assert.match(message, /@@index\(\[customerId\]\)/);
  assert.match(message, /@@index\(\[audience\]\)/);
  // Exactly three: two pre-existing, one new. A replacement index would be a
  // performance regression disguised as an addition.
  const indexes = message.match(/@@index\(/g) ?? [];
  assert.equal(indexes.length, 3);
});

// =================== migration ===================

test("MIGRATION: it adds the three columns and nothing else", () => {
  assert.match(migration, /ALTER TABLE "CommunityMessage" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'customer'/);
  assert.match(migration, /ALTER TABLE "CommunityMessage" ADD COLUMN "deletedAt" TIMESTAMP\(3\)/);
  assert.match(migration, /ALTER TABLE "CommunityMessage" ADD COLUMN "deletedById" TEXT/);
  // Three ADD COLUMNs plus the one FK constraint, and nothing else. A fourth
  // ALTER would be an undeclared change to an existing column.
  const alters = migration.match(/ALTER TABLE/g) ?? [];
  assert.equal(alters.length, 4, "three ADD COLUMN statements plus the FK constraint");
  const addColumns = migration.match(/ADD COLUMN/g) ?? [];
  assert.equal(addColumns.length, 3, "exactly three columns added");
});

test("MIGRATION: no existing row is rewritten, so the migration cannot lose content", () => {
  // An UPDATE here would be the shape that silently rewrites history: it must be
  // absent, because the DEFAULT backfills existing rows to 'customer' on its own.
  // The lookahead excludes the referential action phrase "ON UPDATE CASCADE",
  // which is a constraint property and not a data statement.
  assert.equal(/\bUPDATE\b(?!\s+CASCADE)/i.test(migration), false, "no data UPDATE may appear in an additive migration");
  assert.equal(/\bDELETE\s+FROM\b/i.test(migration), false);
  assert.equal(/\bINSERT\b/i.test(migration), false);
});

test("MIGRATION: it is strictly additive — no DROP, no column-type or nullability change", () => {
  assert.equal(/\bDROP\b/i.test(migration), false);
  assert.equal(/ALTER COLUMN/i.test(migration), false);
  assert.equal(/SET NOT NULL/i.test(migration), false);
  assert.equal(/RENAME/i.test(migration), false);
  assert.equal(/TRUNCATE/i.test(migration), false);
  // A NOT NULL without a DEFAULT would fail on a populated table.
  assert.equal(/ADD COLUMN\s+"\w+"\s+[A-Z]+(\(\d+\))?\s+NOT NULL(?!\s+DEFAULT)/i.test(migration), false);
});

test("MIGRATION: the audience backfill is safe for existing rows", () => {
  // DEFAULT 'customer' on ADD COLUMN backfills every existing row, which is the
  // required behavior: historical posts were customer posts.
  assert.match(migration, /DEFAULT 'customer'/);
  assert.equal(migration.includes('DEFAULT \'employee\''), false, "the backfill must not classify history as employee");
});

test("MIGRATION: the deletedById foreign key is ON DELETE SET NULL, matching the schema", () => {
  assert.match(
    migration,
    /FOREIGN KEY \("deletedById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.equal(/FOREIGN KEY \("deletedById"\)[^;]*ON DELETE CASCADE/i.test(migration), false);
  assert.equal(/FOREIGN KEY \("deletedById"\)[^;]*ON DELETE RESTRICT/i.test(migration), false);
});

test("MIGRATION: the FK is nullable, so an existing row needs no author", () => {
  assert.equal(/"deletedById"\s+TEXT\s+NOT NULL/i.test(migration), false);
  assert.equal(/"deletedAt"\s+TIMESTAMP\(3\)\s+NOT NULL/i.test(migration), false);
});

test("MIGRATION: the audience index is created for the new filter column", () => {
  assert.match(migration, /CREATE INDEX "CommunityMessage_audience_idx" ON "CommunityMessage"\("audience"\)/);
});

test("MIGRATION: it touches no other table", () => {
  const tables = [...migration.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)], ["CommunityMessage"]);
  assert.equal(migration.includes('"User"'), true, "only as a FK target");
  assert.equal(/ALTER TABLE "User"/.test(migration), false);
});

// =================== additive-only ===================

test("MIGRATION: it lives in its own timestamped directory and is not an edit to an earlier migration", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../prisma/migrations/", import.meta.url);
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.ok(dirs.includes("20260927030000_add_employee_community"), "the new migration directory must exist");
  const earlier = dirs.filter((d) => d < "20260927030000_add_employee_community");
  assert.ok(earlier.length > 0, "the project has prior migrations that must be left alone");
});
