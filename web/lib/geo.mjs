// Location assistance for the booking address fields.
// All browser/network access is injectable so the module can be unit-tested
// with plain Node (no JSX, no browser). Reverse geocoding is performed by the
// backend proxy (Nominatim, no key), so no API key ever reaches this code or
// the browser. Stripe Tax remains a server-side authority; nothing here
// computes tax.

const DEFAULT_TIMEOUT_MS = 8000;

export const GEO_ERROR = Object.freeze({
  UNSUPPORTED: "Your browser doesn't support location. Please enter your address manually.",
  DENIED: "Location permission was denied. You can still enter your address manually.",
  UNAVAILABLE: "We couldn't determine your location. Please enter your address manually.",
  TIMEOUT: "Location lookup timed out. Please enter your address manually.",
  ERROR: "We couldn't access your location right now. Please enter your address manually.",
  GEOCODE_FAILED: "We couldn't resolve your location to an address. Please enter it manually.",
  INCOMPLETE: "We couldn't get a complete address from your location. Please review and correct it.",
});

export function isCompleteAddress(address) {
  return !!(
    address &&
    typeof address.line1 === "string" && address.line1.trim() &&
    typeof address.city === "string" && address.city.trim() &&
    typeof address.state === "string" && address.state.trim() &&
    typeof address.postalCode === "string" && address.postalCode.trim() &&
    typeof address.country === "string" && address.country.trim()
  );
}

function mapGeoError(err) {
  const code = err && typeof err.code === "number" ? err.code : -1;
  if (code === 1) return { ok: false, code: "DENIED", message: GEO_ERROR.DENIED };
  if (code === 2) return { ok: false, code: "UNAVAILABLE", message: GEO_ERROR.UNAVAILABLE };
  if (code === 3) return { ok: false, code: "TIMEOUT", message: GEO_ERROR.TIMEOUT };
  return { ok: false, code: "ERROR", message: GEO_ERROR.ERROR };
}

export function requestLocation({ geolocation, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
      resolve({ ok: false, code: "UNSUPPORTED", message: GEO_ERROR.UNSUPPORTED });
      return;
    }
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    const timer = setTimeout(() => done({ ok: false, code: "TIMEOUT", message: GEO_ERROR.TIMEOUT }), timeoutMs + 250);
    try {
      geolocation.getCurrentPosition(
        (pos) =>
          done({
            ok: true,
            coords: { lat: pos.coords.latitude, lon: pos.coords.longitude },
          }),
        (err) => done(mapGeoError(err)),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 0 },
      );
    } catch {
      done({ ok: false, code: "ERROR", message: GEO_ERROR.ERROR });
    }
  });
}

// Calls the backend reverse-geocode proxy (which performs Nominatim server-side).
export async function reverseGeocode({ lat, lon, fetchImpl }) {
  const doFetch =
    fetchImpl ||
    ((path) => {
      throw new Error("geocode fetchImpl not provided");
    });
  try {
    const data = await doFetch(`/geocode/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`);
    const address = data?.address;
    if (data?.ok && isCompleteAddress(address)) {
      return { ok: true, address, code: "OK", message: null };
    }
    if (address) {
      return { ok: false, code: "INCOMPLETE", message: GEO_ERROR.INCOMPLETE, address };
    }
    return { ok: false, code: "GEOCODE_FAILED", message: GEO_ERROR.GEOCODE_FAILED };
  } catch (err) {
    // The backend returns 422 with a partial address when geocoding is
    // incomplete. The API client throws for non-2xx, so pull the partial
    // address out of the error payload so the form can pre-fill it.
    const partial = err?.data?.address;
    if (partial && Object.keys(partial).some((key) => partial[key])) {
      return { ok: false, code: "INCOMPLETE", message: GEO_ERROR.INCOMPLETE, address: partial };
    }
    return { ok: false, code: "GEOCODE_FAILED", message: GEO_ERROR.GEOCODE_FAILED };
  }
}

// Orchestrates: obtain coordinates (only after user clicks the button) then
// reverse geocode and produce a user-facing outcome. Never submits the booking.
export async function useMyLocation({ geolocation, fetchImpl }) {
  const loc = await requestLocation({ geolocation });
  if (!loc.ok) return loc;
  return reverseGeocode({ lat: loc.coords.lat, lon: loc.coords.lon, fetchImpl });
}
