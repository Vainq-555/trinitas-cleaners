import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL("../prisma/migrations/20260920000000_add_community_groups/migration.sql", import.meta.url);
const inviteCodeMigrationPath = new URL("../prisma/migrations/20260921000000_add_group_invite_code/migration.sql", import.meta.url);

const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

function modelBlock(name) {
  const match = schema.match(new RegExp(`^model ${name} \\{([^]*?)^\\}`, "m"));
  assert.ok(match, `expected model ${name} to exist in schema.prisma`);
  return match[1];
}

function normalize(line) {
  return line.trim().replace(/\s+/g, " ");
}

function blockLines(name) {
  return modelBlock(name)
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map(normalize);
}

function assertHas(block, line) {
  assert.ok(blockLinesFrom(block).includes(normalize(line)), `expected block to contain line: ${line}`);
}

const cache = new Map();
function blockLinesFrom(block) {
  if (!cache.has(block)) {
    cache.set(block, block.split("\n").filter((l) => l.trim() !== "").map(normalize));
  }
  return cache.get(block);
}

test("G1a schema: Group exists with expected fields and owner relation", () => {
  const block = modelBlock("Group");
  for (const line of [
    "id String @id @default(cuid())",
    "ownerId String",
    "name String",
    "description String?",
    "type String @default(\"public\")",
    "createdAt DateTime @default(now())",
    "updatedAt DateTime @updatedAt",
    "dissolvedAt DateTime?",
    'owner User @relation("GroupOwner", fields: [ownerId], references: [id], onDelete: Cascade)',
    "members GroupMember[]",
    "messages GroupMessage[]",
    "@@index([ownerId])",
    "@@index([dissolvedAt])",
    "@@index([createdAt])",
    "@@index([type])",
  ]) {
    assertHas(block, line);
  }
});

test("G1a schema: GroupMember exists with composite key on (groupId, userId)", () => {
  const block = modelBlock("GroupMember");
  for (const line of [
    "groupId String",
    "userId String",
    "joinedAt DateTime @default(now())",
    "group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)",
    "user User @relation(fields: [userId], references: [id], onDelete: Cascade)",
    "@@id([groupId, userId])",
    "@@index([userId])",
  ]) {
    assertHas(block, line);
  }
});

test("G1a schema: GroupMessage exists with expected fields", () => {
  const block = modelBlock("GroupMessage");
  for (const line of [
    "id String @id @default(cuid())",
    "groupId String",
    "senderId String",
    "content String",
    "createdAt DateTime @default(now())",
    "deletedAt DateTime?",
    "deletedById String?",
    "group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)",
    "sender User @relation(fields: [senderId], references: [id], onDelete: Cascade)",
    "@@index([groupId, createdAt])",
    "@@index([senderId])",
  ]) {
    assertHas(block, line);
  }
});

test("G1a schema: User carries the three unambiguous back-relations", () => {
  const block = modelBlock("User");
  for (const line of [
    'groupsOwned Group[] @relation("GroupOwner")',
    "groupMembers GroupMember[]",
    "groupMessages GroupMessage[]",
  ]) {
    assertHas(block, line);
  }
});

test("G1a schema: no native enum introduced", () => {
  assert.equal(/^enum\s+\w+/m.test(schema), false, "schema must not declare a Prisma/PostgreSQL enum");
});

test("G1a schema: existing Community/Profile/Message models unchanged", () => {
  const expected = {
    Message: [
      "id String @id @default(cuid())",
      "senderId String",
      "receiverId String",
      "content String",
      "readAt DateTime?",
      "createdAt DateTime @default(now())",
      'sender User @relation("Sender", fields: [senderId], references: [id], onDelete: Cascade)',
      'receiver User @relation("Receiver", fields: [receiverId], references: [id], onDelete: Cascade)',
      "@@index([senderId])",
      "@@index([receiverId])",
    ],
    CommunityMessage: [
      "id String @id @default(cuid())",
      "customerId String",
      "content String",
      "createdAt DateTime @default(now())",
      "customer User @relation(fields: [customerId], references: [id], onDelete: Cascade)",
      "@@index([createdAt])",
      "@@index([customerId])",
    ],
    CommunityProfile: [
      "id String @id @default(cuid())",
      "userId String @unique",
      "displayName String",
      "bio String?",
      "avatarUrl String?",
      "locationCity String?",
      "locationState String?",
      "showOnline Boolean @default(true)",
      "profileVisible Boolean @default(true)",
      "moderationHiddenAt DateTime?",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt",
      "user User @relation(fields: [userId], references: [id], onDelete: Cascade)",
      "@@index([displayName])",
    ],
  };

  // Message and CommunityProfile are untouched by every phase, so they are still
  // held to an EXACT list. This remains the guard it was written to be.
  for (const name of ["Message", "CommunityProfile"]) {
    assert.deepEqual(blockLines(name), expected[name], `model ${name} must remain unchanged`);
  }

  // CommunityMessage IS extended, additively, by Phase 2B-5 (the employee
  // community's `audience` column plus admin soft delete). The guard is
  // therefore restated in the only form that is still meaningful for an
  // additively-extended model, and it is just as strict:
  //   (a) EVERY original line is still present, verbatim — nothing was removed,
  //       renamed, retyped or re-defaulted; and
  //   (b) the set of additional lines is EXACTLY the five Phase 2B-5 lines.
  // Any other edit — a dropped field, a changed default, an extra column — fails.
  const actual = blockLines("CommunityMessage");
  for (const line of expected.CommunityMessage) {
    assert.ok(actual.includes(line), `model CommunityMessage must still contain: ${line}`);
  }
  const original = new Set(expected.CommunityMessage);
  const additions = actual.filter((l) => !l.startsWith("//") && !original.has(l));
  assert.deepEqual(additions, [
    // The load-bearing column: NOT NULL DEFAULT 'customer', so every
    // pre-existing customer post is backfilled in place and unchanged.
    'audience String @default("customer")',
    // Admin soft delete (mirrors GroupMessage).
    "deletedAt DateTime?",
    "deletedById String?",
    'deletedBy User? @relation("CommunityMessageDeletedBy", fields: [deletedById], references: [id], onDelete: SetNull)',
    "@@index([audience])",
  ], "CommunityMessage may gain ONLY the additive Phase 2B-5 lines");
});

test("G1f schema: Group carries a nullable unique inviteCode", () => {
  const block = modelBlock("Group");
  assertHas(block, "inviteCode String? @unique");
});

test("G1f migration: additive-only ALTER on Group adding the unique invite code", () => {
  const src = readFileSync(inviteCodeMigrationPath, "utf8");
  assert.ok(
    /\bALTER TABLE "Group" ADD COLUMN "inviteCode" TEXT;/m.test(src),
    "migration must add the inviteCode column to Group",
  );
  assert.ok(
    /CREATE UNIQUE INDEX "Group_inviteCode_key" ON "Group"\("inviteCode"\);/m.test(src),
    "migration must create the unique index on inviteCode",
  );
  // The migration must not touch any other table.
  const altered = new Set([...src.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...altered], ["Group"], "only the Group table may be altered");
  assert.ok(!/DROP\b/.test(src), "the migration must be additive-only");
});

test("G1a migration: additive-only, creates the three tables with cascade FKs", () => {
  const existingTables = [
    "User",
    "Service",
    "CustomPrice",
    "Booking",
    "Payment",
    "Review",
    "StripeWebhookEvent",
    "Receipt",
    "Promotion",
    "PromotionService",
    "Message",
    "CommunityMessage",
    "CommunityProfile",
    "Broadcast",
    "UserBroadcastRead",
    "ContentSection",
    "BusinessInfo",
    "ServiceArea",
    "PasswordResetToken",
  ];
  const alterRegex = /ALTER TABLE "([^"]+)"/g;
  const altered = new Set([...migration.matchAll(alterRegex)].map((m) => m[1]));
  for (const changed of altered) {
    const isNew = ["Group", "GroupMember", "GroupMessage"].includes(changed);
    assert.ok(isNew, `migration must not ALTER pre-existing table ${changed}`);
  }

  for (const table of ["Group", "GroupMember", "GroupMessage"]) {
    assert.ok(migration.includes(`CREATE TABLE "${table}"`), `migration must create ${table}`);
  }

  assert.ok(migration.includes('CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","userId")'), "GroupMember composite PK");
  assert.ok(migration.includes('CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId")'), "GroupMember userId index");
  assert.ok(migration.includes('CREATE INDEX "GroupMessage_groupId_createdAt_idx" ON "GroupMessage"("groupId", "createdAt")'), "GroupMessage (groupId, createdAt) index");
  assert.ok(migration.includes('REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE'), "cascade FKs to User");
  assert.ok(migration.includes('REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE'), "cascade FKs to Group");
});