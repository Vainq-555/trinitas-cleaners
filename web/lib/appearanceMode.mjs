export const APPEARANCE_KEY = "trinitas.appearance";

export const VALID = ["light", "dark", "system"];

export function parseStored(k) {
  return VALID.includes(k) ? k : "system";
}

export function readStored() {
  try {
    return parseStored(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return "system";
  }
}

export function systemPrefersDark() {
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function resolve(mode, systemDark) {
  const m = parseStored(mode);
  return m === "system" ? (systemDark ? "dark" : "light") : m;
}

export function isAdminPath(p) {
  return String(p || "").replace(/\/$/, "").startsWith("/admin");
}

export function effectiveFor(pathname, mode, systemDark) {
  return isAdminPath(pathname) ? "light" : resolve(mode, systemDark);
}

export function applyDark(active) {
  const r = document.documentElement;
  r.classList.toggle("dark", active);
  r.style.colorScheme = active ? "dark" : "light";
}

export const APPEARANCE_BOOT = `(function () {
  try {
    if (location.pathname.replace(/\\/+$/, '').startsWith('/admin')) return;
    var k = null;
    try { k = localStorage.getItem('trinitas.appearance'); } catch (e) { k = null; }
    var mode = (k === 'light' || k === 'dark' || k === 'system') ? k : 'system';
    var dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();`;