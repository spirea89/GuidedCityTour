/**
 * Place search + reverse geocode for the browser.
 * Prefer Photon (Komoot) — CORS-friendly and not rate-limited like public Nominatim.
 * Fall back to Nominatim when Photon fails; serialize Nominatim to ~1 req/sec.
 */
import { NOMINATIM_HEADERS, PHOTON_BASE } from "../config.js";

/** @typedef {"photon"|"nominatim"} GeocoderSource */

export class GeocoderError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, source?: string }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = "GeocoderError";
    this.status = meta.status || 0;
    this.code = meta.code || "geocoder_error";
    this.source = meta.source || "";
  }
}

let nominatimChain = Promise.resolve();
let nominatimNextAt = 0;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Serialize Nominatim calls and space them by ~1.1s (usage policy). */
async function withNominatimSlot(fn, signal) {
  const run = nominatimChain.then(async () => {
    const wait = Math.max(0, nominatimNextAt - Date.now());
    if (wait) await sleep(wait, signal);
    try {
      return await fn();
    } finally {
      nominatimNextAt = Date.now() + 1100;
    }
  });
  // Keep the chain alive even if this call fails/aborts
  nominatimChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function photonHeaders() {
  return {
    Accept: "application/json",
    "Accept-Language":
      typeof navigator !== "undefined" ? navigator.language || "en" : "en",
  };
}

/**
 * Map a Photon GeoJSON feature into a Nominatim-shaped hit used elsewhere.
 * @param {object} feature
 */
export function photonFeatureToHit(feature) {
  if (!feature) return null;
  const props = feature.properties || {};
  const coords =
    feature.geometry && Array.isArray(feature.geometry.coordinates)
      ? feature.geometry.coordinates
      : null;
  if (!coords || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!isFinite(lat) || !isFinite(lon)) return null;

  const osmKey = String(props.osm_key || "").toLowerCase();
  const osmValue = String(props.osm_value || "").toLowerCase();
  const name = props.name ? String(props.name).trim() : "";

  const address = {
    house_number: props.housenumber ? String(props.housenumber) : "",
    road: props.street ? String(props.street) : "",
    neighbourhood: props.district
      ? String(props.district)
      : props.locality
        ? String(props.locality)
        : "",
    suburb: props.locality ? String(props.locality) : "",
    city_district: props.district ? String(props.district) : "",
    city: props.city ? String(props.city) : "",
    town: props.town ? String(props.town) : "",
    village: props.village ? String(props.village) : "",
    municipality: props.city ? String(props.city) : "",
    county: props.county ? String(props.county) : "",
    state: props.state ? String(props.state) : "",
    postcode: props.postcode ? String(props.postcode) : "",
    country: props.country ? String(props.country) : "",
    country_code: props.countrycode
      ? String(props.countrycode).toLowerCase()
      : "",
  };

  if (name) {
    if (osmKey === "tourism") address.tourism = name;
    else if (osmKey === "historic") address.historic = name;
    else if (osmKey === "amenity") address.amenity = osmValue || name;
    else if (osmKey === "leisure") address.leisure = osmValue || name;
    else if (osmKey === "building" && osmValue && osmValue !== "yes") {
      address.building = osmValue;
    } else if (osmKey === "man_made") address.man_made = osmValue || name;
  }

  const displayParts = [];
  if (name) displayParts.push(name);
  else if (address.house_number && address.road) {
    displayParts.push(address.road + " " + address.house_number);
  } else if (address.road) displayParts.push(address.road);
  if (address.city || address.town || address.village) {
    displayParts.push(address.city || address.town || address.village);
  }
  if (address.country) displayParts.push(address.country);

  return {
    lat: String(lat),
    lon: String(lon),
    display_name: displayParts.join(", ") || name || lat + ", " + lon,
    class: osmKey || "place",
    type: osmValue || "yes",
    name: name,
    address,
    namedetails: name ? { name: name } : {},
    extratags: {},
    osm_id: props.osm_id != null ? props.osm_id : null,
    osm_type: props.osm_type ? String(props.osm_type).toLowerCase() : null,
    source: "photon",
  };
}

function statusErrorMessage(status, action) {
  if (status === 429) {
    return (
      "Location service is rate-limited (HTTP 429). Wait a few seconds and try again."
    );
  }
  if (status === 403) {
    return "Location service blocked the request (HTTP 403).";
  }
  if (status >= 500) {
    return "Location service is temporarily unavailable (HTTP " + status + ").";
  }
  return (
    (action || "Location lookup") + " failed" + (status ? " (" + status + ")" : "")
  );
}

async function photonSearch(query, limit, signal) {
  const url =
    PHOTON_BASE +
    "/api/?q=" +
    encodeURIComponent(query) +
    "&limit=" +
    encodeURIComponent(String(limit)) +
    "&lang=en";
  const res = await fetch(url, { headers: photonHeaders(), signal });
  if (!res.ok) {
    throw new GeocoderError(statusErrorMessage(res.status, "Search"), {
      status: res.status,
      code: res.status === 429 ? "rate_limited" : "photon_search_failed",
      source: "photon",
    });
  }
  const data = await res.json();
  const features = data && Array.isArray(data.features) ? data.features : [];
  return features.map(photonFeatureToHit).filter(Boolean);
}

async function photonReverse(lat, lng, signal) {
  const url =
    PHOTON_BASE +
    "/reverse?lat=" +
    encodeURIComponent(lat) +
    "&lon=" +
    encodeURIComponent(lng) +
    "&lang=en";
  const res = await fetch(url, { headers: photonHeaders(), signal });
  if (!res.ok) {
    throw new GeocoderError(statusErrorMessage(res.status, "Reverse geocode"), {
      status: res.status,
      code: res.status === 429 ? "rate_limited" : "photon_reverse_failed",
      source: "photon",
    });
  }
  const data = await res.json();
  const features = data && Array.isArray(data.features) ? data.features : [];
  const hit = features.length ? photonFeatureToHit(features[0]) : null;
  if (!hit) {
    throw new GeocoderError("No reverse-geocode result for this pin.", {
      code: "no_results",
      source: "photon",
    });
  }
  return hit;
}

async function nominatimSearch(query, limit, signal) {
  return withNominatimSlot(async () => {
    const url =
      "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(query) +
      "&format=json&addressdetails=1&extratags=1&namedetails=1&limit=" +
      encodeURIComponent(String(limit));
    const res = await fetch(url, { headers: NOMINATIM_HEADERS, signal });
    if (!res.ok) {
      throw new GeocoderError(statusErrorMessage(res.status, "Search"), {
        status: res.status,
        code: res.status === 429 ? "rate_limited" : "nominatim_search_failed",
        source: "nominatim",
      });
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((hit) => Object.assign({}, hit, { source: "nominatim" }));
  }, signal);
}

async function nominatimReverse(lat, lng, signal) {
  return withNominatimSlot(async () => {
    const url =
      "https://nominatim.openstreetmap.org/reverse?lat=" +
      encodeURIComponent(lat) +
      "&lon=" +
      encodeURIComponent(lng) +
      "&format=json&addressdetails=1&extratags=1&namedetails=1&zoom=18";
    const res = await fetch(url, { headers: NOMINATIM_HEADERS, signal });
    if (!res.ok) {
      throw new GeocoderError(statusErrorMessage(res.status, "Reverse geocode"), {
        status: res.status,
        code: res.status === 429 ? "rate_limited" : "nominatim_reverse_failed",
        source: "nominatim",
      });
    }
    const data = await res.json();
    if (!data || data.error) {
      throw new GeocoderError(
        (data && data.error) || "No reverse-geocode result for this pin.",
        { code: "no_results", source: "nominatim" }
      );
    }
    return Object.assign({}, data, { source: "nominatim" });
  }, signal);
}

/**
 * Search places. Photon first, Nominatim fallback.
 * @returns {Promise<object[]>} Nominatim-shaped hits
 */
export async function searchPlaces(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const limit = options.limit || 1;
  const signal = options.signal;

  try {
    const hits = await photonSearch(q, limit, signal);
    if (hits.length) return hits;
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    // fall through to Nominatim
  }

  try {
    return await nominatimSearch(q, limit, signal);
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    if (err instanceof GeocoderError) throw err;
    throw new GeocoderError(
      (err && err.message) ||
        "Search failed. Check your connection and try again.",
      { code: "search_failed" }
    );
  }
}

/**
 * Reverse-geocode a pin. Photon first, Nominatim fallback.
 * @returns {Promise<object>} Nominatim-shaped hit
 */
export async function reverseGeocodePlace(lat, lng, options = {}) {
  const signal = options.signal;
  let lastErr = null;

  try {
    return await photonReverse(lat, lng, signal);
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    lastErr = err;
  }

  try {
    return await nominatimReverse(lat, lng, signal);
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    lastErr = err;
    if (err instanceof GeocoderError) throw err;
    throw new GeocoderError(
      (err && err.message) ||
        "Could not look up this location. Try again in a moment.",
      { code: "reverse_failed" }
    );
  }
}

/**
 * Bounded nearby text search (Photon) for story grounding / chips-style lists.
 * @returns {Promise<object[]>}
 */
export async function searchNearbyText(query, lat, lng, options = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const limit = options.limit || 12;
  const signal = options.signal;
  const url =
    PHOTON_BASE +
    "/api/?q=" +
    encodeURIComponent(q) +
    "&lat=" +
    encodeURIComponent(lat) +
    "&lon=" +
    encodeURIComponent(lng) +
    "&limit=" +
    encodeURIComponent(String(limit)) +
    "&lang=en";
  try {
    const res = await fetch(url, { headers: photonHeaders(), signal });
    if (!res.ok) return [];
    const data = await res.json();
    const features = data && Array.isArray(data.features) ? data.features : [];
    return features.map(photonFeatureToHit).filter(Boolean);
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    return [];
  }
}

export function formatGeocoderError(err, fallback) {
  if (!err) return fallback || "Location lookup failed.";
  if (err.name === "AbortError") return "";
  if (err instanceof GeocoderError) return err.message;
  return (err && err.message) || fallback || "Location lookup failed.";
}
