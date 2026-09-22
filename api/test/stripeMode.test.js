import test from "node:test";
import assert from "node:assert/strict";
import { stripeSecretKeyMode } from "../src/config.js";

const withEnv = async (env, fn) => {
  const prev = process.env.NODE_ENV;
  try {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    await fn();
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
};

test("non-production accepts test secret keys", async () => {
  await withEnv(undefined, () => assert.equal(stripeSecretKeyMode("sk_test_abc123"), "test"));
  await withEnv("development", () => assert.equal(stripeSecretKeyMode("sk_test_abc123"), "test"));
  await withEnv("test", () => assert.equal(stripeSecretKeyMode("sk_test_abc123"), "test"));
});

test("non-production rejects live, publishable, restricted, malformed, and absent keys", async () => {
  await withEnv(undefined, () => {
    assert.equal(stripeSecretKeyMode("sk_live_abc123"), null);
    assert.equal(stripeSecretKeyMode("pk_test_abc123"), null);
    assert.equal(stripeSecretKeyMode("rk_live_abc123"), null);
    assert.equal(stripeSecretKeyMode("sk_test"), null); // incomplete prefix only
    assert.equal(stripeSecretKeyMode("not-a-stripe-key"), null);
    assert.equal(stripeSecretKeyMode(""), null);
    assert.equal(stripeSecretKeyMode(null), null);
    assert.equal(stripeSecretKeyMode(undefined), null);
  });
});

test("production accepts live secret keys", async () => {
  await withEnv("production", () => assert.equal(stripeSecretKeyMode("sk_live_abc123"), "live"));
});

test("production rejects test, publishable, restricted, malformed, and absent keys", async () => {
  await withEnv("production", () => {
    assert.equal(stripeSecretKeyMode("sk_test_abc123"), null);
    assert.equal(stripeSecretKeyMode("pk_live_abc123"), null);
    assert.equal(stripeSecretKeyMode("rk_live_abc123"), null);
    assert.equal(stripeSecretKeyMode("sk_live"), null);
    assert.equal(stripeSecretKeyMode(null), null);
    assert.equal(stripeSecretKeyMode(undefined), null);
  });
});

test("defaults to the configured secret key without throwing", async () => {
  const mode = stripeSecretKeyMode();
  assert.ok(mode === "test" || mode === "live" || mode === null);
});