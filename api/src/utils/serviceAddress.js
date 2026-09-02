// Structural service-address validation for the booking flow.
//
// This is SYNTAX/STRUCTURE validation only. It never calculates tax, never
// calls any provider, and never guesses missing information. Stripe Tax
// remains the sole tax authority. The US rules below normalize harmless
// casing/whitespace (and full state names such as "Minnesota" from the
// existing reverse-geocoding flow) so that legitimately entered or
// location-assisted addresses still reach the existing server-side tax
// pipeline. A value that fails these checks is clearly malformed and is
// rejected before it can be persisted on a new booking.

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY","AS","GU","MP","PR","VI",
]);

const US_STATE_NAMES = new Map([
  ["ALABAMA","AL"],["ALASKA","AK"],["ARIZONA","AZ"],["ARKANSAS","AR"],
  ["CALIFORNIA","CA"],["COLORADO","CO"],["CONNECTICUT","CT"],["DELAWARE","DE"],
  ["DISTRICT OF COLUMBIA","DC"],["FLORIDA","FL"],["GEORGIA","GA"],
  ["HAWAII","HI"],["IDAHO","ID"],["ILLINOIS","IL"],["INDIANA","IN"],
  ["IOWA","IA"],["KANSAS","KS"],["KENTUCKY","KY"],["LOUISIANA","LA"],
  ["MAINE","ME"],["MARYLAND","MD"],["MASSACHUSETTS","MA"],["MICHIGAN","MI"],
  ["MINNESOTA","MN"],["MISSISSIPPI","MS"],["MISSOURI","MO"],["MONTANA","MT"],
  ["NEBRASKA","NE"],["NEVADA","NV"],["NEW HAMPSHIRE","NH"],["NEW JERSEY","NJ"],
  ["NEW MEXICO","NM"],["NEW YORK","NY"],["NORTH CAROLINA","NC"],
  ["NORTH DAKOTA","ND"],["OHIO","OH"],["OKLAHOMA","OK"],["OREGON","OR"],
  ["PENNSYLVANIA","PA"],["RHODE ISLAND","RI"],["SOUTH CAROLINA","SC"],
  ["SOUTH DAKOTA","SD"],["TENNESSEE","TN"],["TEXAS","TX"],["UTAH","UT"],
  ["VERMONT","VT"],["VIRGINIA","VA"],["WASHINGTON","WA"],["WEST VIRGINIA","WV"],
  ["WISCONSIN","WI"],["WYOMING","WY"],["AMERICAN SAMOA","AS"],["GUAM","GU"],
  ["NORTHERN MARIANA ISLANDS","MP"],["PUERTO RICO","PR"],["VIRGIN ISLANDS","VI"],
]);

const US_COUNTRY = ["US", "USA", "UNITED STATES"];
const US_ZIP = /^\d{5}(?:-\d{4})?$/;

function usState(value) {
  const raw = String(value).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (US_STATES.has(upper)) return upper;
  const code = US_STATE_NAMES.get(upper);
  return code || null;
}

function usPostal(value) {
  const raw = String(value).trim();
  if (!raw) return null;
  return US_ZIP.test(raw) ? raw : null;
}

export function normalizeServiceAddress(address) {
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    return { ok: false, error: "The service address is incomplete or invalid." };
  }

  const country = typeof address.country === "string"
    ? address.country.trim().toUpperCase()
    : "";

  const field = (key) =>
    typeof address[key] === "string" ? address[key].trim() : "";

  const line1 = field("line1");
  const line2 = field("line2");
  const city = field("city");
  const state = field("state");
  const postalCode = field("postalCode");

  if (!line1) return { ok: false, error: "The service address is incomplete or invalid (street address is required)." };
  if (!city) return { ok: false, error: "The service address is incomplete or invalid (city is required)." };
  if (!country) return { ok: false, error: "The service address is incomplete or invalid (country is required)." };

  if (US_COUNTRY.includes(country)) {
    const stateCode = usState(state);
    if (!stateCode) {
      return { ok: false, error: "The service address is incomplete or invalid (enter a valid US state, e.g. MN)." };
    }
    const postal = usPostal(postalCode);
    if (!postal) {
      return { ok: false, error: "The service address is incomplete or invalid (enter a valid US ZIP code, e.g. 55303)." };
    }
    return {
      ok: true,
      address: { line1, ...(line2 ? { line2 } : {}), city, state: stateCode, postalCode: postal, country: "US" },
    };
  }

  // Non-US addresses: keep the existing behavior of accepting any country the
  // tax pipeline supports, requiring only structurally complete fields. The
  // app does not verify foreign address formats.
  if (!state) return { ok: false, error: "The service address is incomplete or invalid (state is required)." };
  if (!postalCode) return { ok: false, error: "The service address is incomplete or invalid (postal code is required)." };
  return {
    ok: true,
    address: { line1, ...(line2 ? { line2 } : {}), city, state, postalCode, country },
  };
}