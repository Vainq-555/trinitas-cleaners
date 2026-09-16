import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  APPEARANCE_KEY,
  APPEARANCE_BOOT,
  parseStored,
  readStored,
  systemPrefersDark,
  resolve,
  isAdminPath,
  effectiveFor,
} from "../lib/appearanceMode.mjs";

test("absent stored value normalizes to system", () => {
  assert.equal(parseStored(undefined), "system");
  assert.equal(parseStored(null), "system");
});

test("invalid stored value normalizes to system", () => {
  assert.equal(parseStored("bogus"), "system");
  assert.equal(parseStored(""), "system");
  assert.equal(parseStored(42), "system");
});

test("valid stored values pass through", () => {
  assert.equal(parseStored("light"), "light");
  assert.equal(parseStored("dark"), "dark");
  assert.equal(parseStored("system"), "system");
});

test("readStored reads the appearance key and normalizes absent/invalid", () => {
  const original = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem: (k) => (k === APPEARANCE_KEY ? null : null) };
    assert.equal(readStored(), "system");
    globalThis.localStorage = { getItem: (k) => (k === APPEARANCE_KEY ? "bogus" : null) };
    assert.equal(readStored(), "system");
    globalThis.localStorage = { getItem: (k) => (k === APPEARANCE_KEY ? "dark" : null) };
    assert.equal(readStored(), "dark");
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test("systemPrefersDark reads matchMedia and tolerates absence", () => {
  const original = globalThis.matchMedia;
  try {
    globalThis.matchMedia = () => ({ matches: true });
    assert.equal(systemPrefersDark(), true);
    globalThis.matchMedia = () => ({ matches: false });
    assert.equal(systemPrefersDark(), false);
    delete globalThis.matchMedia;
    assert.equal(systemPrefersDark(), false);
  } finally {
    if (original === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = original;
  }
});

test("resolve: explicit modes win regardless of system preference", () => {
  assert.equal(resolve("light", true), "light");
  assert.equal(resolve("light", false), "light");
  assert.equal(resolve("dark", true), "dark");
  assert.equal(resolve("dark", false), "dark");
});

test("resolve: system follows the OS preference", () => {
  assert.equal(resolve("system", true), "dark");
  assert.equal(resolve("system", false), "light");
});

test("resolve: invalid and absent normalize to system", () => {
  assert.equal(resolve("bogus", true), "dark");
  assert.equal(resolve(undefined, false), "light");
  assert.equal(resolve(null, true), "dark");
});

test("isAdminPath detects the admin tree", () => {
  assert.equal(isAdminPath("/admin"), true);
  assert.equal(isAdminPath("/admin/"), true);
  assert.equal(isAdminPath("/admin/pricing"), true);
  assert.equal(isAdminPath("/admin/pricing/edit"), true);
  assert.equal(isAdminPath("/dashboard"), false);
  assert.equal(isAdminPath("/faq"), false);
  assert.equal(isAdminPath("/"), false);
  assert.equal(isAdminPath(""), false);
  assert.equal(isAdminPath(undefined), false);
});

test("effectiveFor forces admin light regardless of stored mode and OS preference", () => {
  assert.equal(effectiveFor("/admin", "dark", true), "light");
  assert.equal(effectiveFor("/admin", "dark", false), "light");
  assert.equal(effectiveFor("/admin", "system", true), "light");
  assert.equal(effectiveFor("/admin", "system", false), "light");
  assert.equal(effectiveFor("/admin/pricing", "dark", true), "light");
});

test("effectiveFor honors trailing slashes on admin paths", () => {
  assert.equal(effectiveFor("/admin/", "dark", true), "light");
  assert.equal(effectiveFor("/admin/pricing/", "dark", true), "light");
});

test("effectiveFor applies the resolved mode on customer/public paths", () => {
  assert.equal(effectiveFor("/dashboard", "dark", false), "dark");
  assert.equal(effectiveFor("/faq", "light", true), "light");
  assert.equal(effectiveFor("/faq", "system", true), "dark");
  assert.equal(effectiveFor("/faq", "system", false), "light");
});

test("resolver consistency: canonical resolve matches an independent implementation", () => {
  const plain = (mode, systemDark) => {
    const m = ["light", "dark", "system"].includes(mode) ? mode : "system";
    return m === "system" ? (systemDark ? "dark" : "light") : m;
  };
  const modes = ["light", "dark", "system", "bogus", "", undefined, null, 42];
  for (const mode of modes) {
    for (const systemDark of [true, false]) {
      assert.equal(resolve(mode, systemDark), plain(mode, systemDark), `mode=${String(mode)} systemDark=${systemDark}`);
    }
  }
});

function runBoot(stored, pathname, systemDark) {
  const toggleCalls = [];
  const style = {};
  const sandbox = {
    location: { pathname },
    localStorage: { getItem: (k) => (k === APPEARANCE_KEY ? stored : null) },
    matchMedia: () => ({ matches: systemDark }),
    document: {
      documentElement: {
        classList: { toggle: (name, on) => toggleCalls.push([name, on]) },
        style,
      },
    },
  };
  vm.runInNewContext(APPEARANCE_BOOT, sandbox);
  const applied = toggleCalls.find(([name]) => name === "dark");
  const effectiveDark = applied ? applied[1] : false;
  return { effectiveDark, style };
}

test("boot parity: boot script and canonical resolver agree for all cases", () => {
  const cases = [
    { stored: null, systemDark: false, path: "/faq" },
    { stored: null, systemDark: true, path: "/faq" },
    { stored: "light", systemDark: true, path: "/faq" },
    { stored: "dark", systemDark: false, path: "/faq" },
    { stored: "system", systemDark: true, path: "/how-it-works" },
    { stored: "system", systemDark: false, path: "/how-it-works" },
    { stored: "bogus", systemDark: true, path: "/faq" },
    { stored: "bogus", systemDark: false, path: "/faq" },
    { stored: "dark", systemDark: true, path: "/admin" },
    { stored: "dark", systemDark: false, path: "/admin/pricing" },
    { stored: "system", systemDark: true, path: "/admin/" },
    { stored: "system", systemDark: false, path: "/admin/" },
  ];
  for (const c of cases) {
    const storedMode = c.stored === null || c.stored === undefined ? "system" : parseStored(c.stored);
    const expected = effectiveFor(c.path, storedMode, c.systemDark) === "dark";
    const { effectiveDark, style } = runBoot(c.stored, c.path, c.systemDark);
    assert.equal(effectiveDark, expected, `boot dark mismatch for ${JSON.stringify(c)}`);
    if (effectiveDark) {
      assert.equal(style.colorScheme, "dark", `colorScheme for ${JSON.stringify(c)}`);
    } else if (isAdminPath(c.path)) {
      assert.equal(style.colorScheme, undefined, `admin boot must not set colorScheme for ${JSON.stringify(c)}`);
    } else {
      assert.equal(style.colorScheme, "light", `colorScheme for ${JSON.stringify(c)}`);
    }
  }
});