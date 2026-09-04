import { badRequest } from "../utils/validators.js";

const NOMINATIM_URL =
  process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/reverse";

const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  "trinitas-cleaners/1.0 (https://web.trinitaso.com; support@trinitaso.com)";

// Server-side reverse geocoding via Nominatim (OpenStreetMap). No API key is
// used, so no secret ever reaches the browser. The result is returned only as
// the small address shape the booking/tax flow already expects.
export async function reverseGeocode(req, res, deps = {}) {
  const {
    geocodeFetch = defaultFetch,
    now = () => Date.now(),
  } = deps;

  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return badRequest(res, "A valid lat and lon are required");
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return badRequest(res, "Invalid coordinates");
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");

  let payload;
  try {
    payload = await geocodeFetch(url.toString(), {
      headers: { "User-Agent": NOMINATIM_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error("Reverse geocode request failed", now(), error?.message);
    return res.status(503).json({ error: "Unable to determine your location right now. Please enter your address manually." });
  }

  let data;
  try {
    data = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    return res.status(502).json({ error: "We couldn't resolve your location to an address. Please enter it manually." });
  }

  const address = data?.address;
  const line1 = [address?.house_number, address?.road].filter(Boolean).join(" ").trim();
  const city = address?.city || address?.town || address?.village || "";
  const state = (address?.state || "").replace(/\b(State|Province)\b/g, "").trim();
  const postalCode = address?.postcode || "";
  const country = (address?.country_code || "US").toUpperCase();

  if (!line1 || !city || !state || !postalCode) {
    return res.status(422).json({
      error: "We couldn't get a complete address from your location. Please review and enter it manually.",
      address: { line1, city, state, postalCode, country },
    });
  }

  return res.json({
    ok: true,
    coords: { lat, lon },
    address: { line1, city, state, postalCode, country },
  });
}

async function defaultFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(`Nominatim responded ${res.status}: ${message.slice(0, 120)}`);
  }
  return res.json();
}
