/**
 * Finds named tourist / landmark POIs near a map click.
 * Prefers stadiums, museums, churches, castles, monuments, parks, arenas, etc.
 * over bare highway / road reverse-geocode hits.
 */
import {
  LANDMARK_RADIUS_M,
  LANDMARK_HIGH_CONFIDENCE_SCORE,
  OVERPASS_URL,
} from "../config.js";
import { ENTITY_TYPES, inferEntityType } from "../models/place.js";

/** Headers for Nominatim / Overpass. Node 22 exposes navigator.userAgent as
 * "Node.js/..." which Nominatim rejects - send an app UA in that case.
 * Browsers already send a real UA; custom User-Agent is ignored there. */
function osmClientHeaders() {
  const headers = {
    Accept: "application/json",
    "Accept-Language":
      typeof navigator !== "undefined" && navigator.language
        ? navigator.language
        : "en",
  };
  const ua =
    typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  if (!ua || /node\.js/i.test(ua)) {
    headers["User-Agent"] =
      "GuidedCityTour/2.2.3 (https://github.com/spirea89/GuidedCityTour)";
  }
  return headers;
}

/** OSM class/type pairs that count as tour landmarks (score weight). */
const TYPE_SCORES = {
  "leisure/stadium": 100,
  "building/stadium": 100,
  "sport/stadium": 95,
  "tourism/museum": 95,
  "amenity/museum": 95,
  "tourism/gallery": 90,
  "tourism/attraction": 90,
  "tourism/theme_park": 90,
  "tourism/zoo": 88,
  "tourism/aquarium": 88,
  "tourism/viewpoint": 85,
  "tourism/artwork": 80,
  "historic/monument": 92,
  "historic/memorial": 88,
  "historic/castle": 95,
  "historic/fort": 90,
  "historic/ruins": 85,
  "historic/archaeological_site": 88,
  "historic/wayside_shrine": 75,
  "amenity/place_of_worship": 90,
  "building/church": 90,
  "building/cathedral": 92,
  "building/chapel": 82,
  "building/mosque": 90,
  "building/synagogue": 90,
  "building/temple": 90,
  "amenity/theatre": 88,
  "amenity/arts_centre": 85,
  "amenity/cinema": 70,
  "leisure/sports_centre": 78,
  "leisure/park": 72,
  "leisure/garden": 70,
  "tourism/yes": 70,
  "man_made/monument": 90,
  "man_made/statue": 85,
  "man_made/tower": 88,
  "leisure/pitch": 35,
};

const SKIP_TYPES = {
  parking: true,
  parking_space: true,
  bicycle_parking: true,
  toilets: true,
  bench: true,
  waste_basket: true,
  recycling: true,
  atm: true,
  vending_machine: true,
  drinking_water: true,
  post_box: true,
  telephone: true,
  fuel: true,
  charging_station: true,
  bus_station: true,
  taxi: true,
};

const TYPE_LABELS = {
  stadium: "stadium",
  museum: "museum",
  gallery: "gallery",
  attraction: "attraction",
  monument: "monument",
  memorial: "memorial",
  castle: "castle",
  fort: "fort",
  ruins: "ruins",
  place_of_worship: "place of worship",
  church: "church",
  cathedral: "cathedral",
  theatre: "theatre",
  arts_centre: "arts centre",
  sports_centre: "sports centre",
  park: "park",
  garden: "garden",
  viewpoint: "viewpoint",
  artwork: "artwork",
  pitch: "sports pitch",
  theme_park: "theme park",
  zoo: "zoo",
  aquarium: "aquarium",
};

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Whether Nominatim class/type looks like a landmark (not road/parking).
 */
export function isLandmarkClassType(cls, typ) {
  const c = String(cls || "").toLowerCase();
  const t = String(typ || "").toLowerCase();
  if (!c || !t) return false;
  if (SKIP_TYPES[t]) return false;
  if (c === "highway" || c === "place" || c === "boundary") return false;
  return TYPE_SCORES[c + "/" + t] != null || c === "tourism" || c === "historic";
}

export function scoreLandmarkType(cls, typ) {
  const c = String(cls || "").toLowerCase();
  const t = String(typ || "").toLowerCase();
  if (SKIP_TYPES[t]) return 0;
  const key = c + "/" + t;
  if (TYPE_SCORES[key] != null) return TYPE_SCORES[key];
  if (c === "tourism") return 75;
  if (c === "historic") return 78;
  if (c === "leisure" && t !== "pitch") return 55;
  return 0;
}

function typeLabel(typ) {
  const t = String(typ || "").toLowerCase();
  return TYPE_LABELS[t] || t || "landmark";
}

function entityFromClassType(cls, typ, tags) {
  const address = Object.assign({}, tags || {}, {
    tourism: (tags && tags.tourism) || (cls === "tourism" ? typ : ""),
    historic: (tags && tags.historic) || (cls === "historic" ? typ : ""),
    amenity: (tags && tags.amenity) || (cls === "amenity" ? typ : ""),
    leisure: (tags && tags.leisure) || (cls === "leisure" ? typ : ""),
    building: (tags && tags.building) || (cls === "building" ? typ : ""),
    man_made: (tags && tags.man_made) || (cls === "man_made" ? typ : ""),
    sport: (tags && tags.sport) || "",
  });
  if (
    String(address.leisure).toLowerCase() === "stadium" ||
    String(address.building).toLowerCase() === "stadium"
  ) {
    return ENTITY_TYPES.LANDMARK;
  }
  return inferEntityType(address, "landmark");
}

/**
 * Build a landmark candidate from a Nominatim reverse/search hit.
 * @returns {object|null}
 */
export function landmarkFromNominatimHit(data, clickLat, clickLng) {
  if (!data) return null;
  const cls = String(data.class || "").toLowerCase();
  const typ = String(data.type || "").toLowerCase();
  if (!isLandmarkClassType(cls, typ)) return null;

  const namedetails = data.namedetails || {};
  const address = data.address || {};
  const name =
    (namedetails.name && String(namedetails.name).trim()) ||
    (data.name && String(data.name).trim()) ||
    String(
      address.tourism ||
        address.historic ||
        address.amenity ||
        address.leisure ||
        address.building ||
        ""
    ).trim();

  if (!name || name.length < 2) return null;
  const lower = name.toLowerCase();
  if (lower === "yes" || lower === "no" || lower === "unnamed") return null;
  // Address fields sometimes hold the type value ("stadium") not the POI name
  if (lower === typ || lower === cls) return null;

  const itemLat = parseFloat(data.lat);
  const itemLng = parseFloat(data.lon);
  const distM =
    isFinite(itemLat) && isFinite(itemLng) && clickLat != null
      ? Math.round(haversineMeters(clickLat, clickLng, itemLat, itemLng))
      : 0;

  const typeScore = scoreLandmarkType(cls, typ);
  if (typeScore <= 0) return null;
  const score = Math.max(0, typeScore - distM * 0.35);

  const tags = Object.assign({}, data.extratags || {}, {
    name,
    [cls]: typ,
  });
  if (address.tourism) tags.tourism = address.tourism;
  if (address.historic) tags.historic = address.historic;
  if (address.leisure) tags.leisure = typ === "stadium" ? "stadium" : tags.leisure;

  return {
    name,
    class: cls,
    type: typ,
    typeLabel: typeLabel(typ),
    entityType: entityFromClassType(cls, typ, tags),
    lat: isFinite(itemLat) ? itemLat : clickLat,
    lng: isFinite(itemLng) ? itemLng : clickLng,
    dist_m: distM,
    score,
    osmTags: tags,
    osmId: data.osm_id || null,
    osmType: data.osm_type || null,
    displayName: data.display_name || name,
    source: "nominatim",
  };
}

function primaryClassTypeFromTags(tags) {
  if (!tags) return { cls: "", typ: "" };
  if (tags.leisure) return { cls: "leisure", typ: String(tags.leisure) };
  if (tags.tourism) return { cls: "tourism", typ: String(tags.tourism) };
  if (tags.historic) return { cls: "historic", typ: String(tags.historic) };
  if (tags.amenity) return { cls: "amenity", typ: String(tags.amenity) };
  if (tags.building && TYPE_SCORES["building/" + tags.building]) {
    return { cls: "building", typ: String(tags.building) };
  }
  if (tags.man_made) return { cls: "man_made", typ: String(tags.man_made) };
  if (tags.sport) return { cls: "sport", typ: String(tags.sport) };
  return { cls: "", typ: "" };
}

function landmarkFromOverpassElement(el, clickLat, clickLng) {
  const tags = el.tags || {};
  const name = String(tags.name || "").trim();
  if (!name || name.length < 2) return null;

  const { cls, typ } = primaryClassTypeFromTags(tags);
  if (!isLandmarkClassType(cls, typ)) return null;

  const itemLat =
    el.lat != null
      ? Number(el.lat)
      : el.center && el.center.lat != null
        ? Number(el.center.lat)
        : NaN;
  const itemLng =
    el.lon != null
      ? Number(el.lon)
      : el.center && el.center.lon != null
        ? Number(el.center.lon)
        : NaN;
  if (!isFinite(itemLat) || !isFinite(itemLng)) return null;

  const distM = Math.round(
    haversineMeters(clickLat, clickLng, itemLat, itemLng)
  );
  if (distM > LANDMARK_RADIUS_M) return null;

  const typeScore = scoreLandmarkType(cls, typ);
  if (typeScore <= 0) return null;
  const score = Math.max(0, typeScore - distM * 0.35);

  return {
    name,
    class: cls,
    type: typ,
    typeLabel: typeLabel(typ),
    entityType: entityFromClassType(cls, typ, tags),
    lat: itemLat,
    lng: itemLng,
    dist_m: distM,
    score,
    osmTags: tags,
    osmId: el.id || null,
    osmType: el.type || null,
    displayName: name,
    source: "overpass",
  };
}

/**
 * Query nearby named landmarks within LANDMARK_RADIUS_M of the click.
 * Overpass only — avoids hammering public Nominatim (which returns HTTP 429
 * when LandmarkFinder used to fire ~10 structured searches per map click).
 */
export async function fetchNearbyLandmarks(lat, lng, signal) {
  try {
    return await fetchLandmarksOverpass(lat, lng, signal);
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    return [];
  }
}

function buildOverpassQuery(lat, lng, radius) {
  const around = "(around:" + radius + "," + lat + "," + lng + ")";
  const named = "nwr" + around + "[name]";
  return (
    "[out:json][timeout:20];\n(\n" +
    "  " +
    named +
    "[tourism];\n" +
    "  " +
    named +
    "[historic];\n" +
    "  " +
    named +
    "[leisure=stadium];\n" +
    "  " +
    named +
    "[leisure=sports_centre];\n" +
    "  " +
    named +
    "[leisure=park];\n" +
    "  " +
    named +
    "[leisure=garden];\n" +
    "  " +
    named +
    "[amenity=theatre];\n" +
    "  " +
    named +
    "[amenity=place_of_worship];\n" +
    "  " +
    named +
    "[amenity=museum];\n" +
    "  " +
    named +
    "[amenity=arts_centre];\n" +
    "  " +
    named +
    "[building=stadium];\n" +
    "  " +
    named +
    "[building=church];\n" +
    "  " +
    named +
    "[building=cathedral];\n" +
    "  " +
    named +
    "[building=chapel];\n" +
    "  " +
    named +
    "[building=castle];\n" +
    "  " +
    named +
    "[man_made=monument];\n" +
    "  " +
    named +
    "[man_made=statue];\n" +
    ");\nout center tags 25;"
  );
}

const OVERPASS_ENDPOINTS = [
  OVERPASS_URL,
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function fetchLandmarksOverpass(lat, lng, signal) {
  const query = buildOverpassQuery(lat, lng, LANDMARK_RADIUS_M);
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    if (signal && signal.aborted) {
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    const endpoint = OVERPASS_ENDPOINTS[i];
    try {
      // GET avoids CORS preflight 406 that POST can trigger in browsers
      const url = endpoint + "?data=" + encodeURIComponent(query);
      const res = await fetch(url, {
        method: "GET",
        headers: osmClientHeaders(),
        signal,
      });
      if (!res.ok) continue;
      const data = await res.json();
      const elements = Array.isArray(data.elements) ? data.elements : [];
      const out = normalizeOverpassElements(elements, lat, lng);
      if (out.length) return out;
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
    }
  }
  return [];
}

function normalizeOverpassElements(elements, lat, lng) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < elements.length; i++) {
    const lm = landmarkFromOverpassElement(elements[i], lat, lng);
    if (!lm) continue;
    const key = lm.name.toLowerCase();
    if (seen.has(key)) {
      const prev = out.find((x) => x.name.toLowerCase() === key);
      if (prev && lm.score > prev.score) Object.assign(prev, lm);
      continue;
    }
    seen.add(key);
    out.push(lm);
  }
  out.sort((a, b) => b.score - a.score || a.dist_m - b.dist_m);
  return out;
}

/**
 * Pick the best landmark for auto-focus (high-confidence only).
 * @param {array} candidates
 * @param {object|null} preferred from search hit
 */
export function pickPreferredLandmark(candidates, preferred) {
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  if (preferred && preferred.name) {
    const pref = Object.assign({}, preferred, {
      score:
        typeof preferred.score === "number" && preferred.score > 0
          ? Math.max(preferred.score, LANDMARK_HIGH_CONFIDENCE_SCORE + 5)
          : LANDMARK_HIGH_CONFIDENCE_SCORE + 20,
      dist_m: typeof preferred.dist_m === "number" ? preferred.dist_m : 0,
    });
    const exists = list.some(
      (c) => c.name.toLowerCase() === pref.name.toLowerCase()
    );
    if (!exists) list.unshift(pref);
    else {
      for (let i = 0; i < list.length; i++) {
        if (list[i].name.toLowerCase() === pref.name.toLowerCase()) {
          list[i] = Object.assign({}, list[i], {
            score: Math.max(list[i].score || 0, pref.score),
          });
        }
      }
    }
  }
  list.sort((a, b) => b.score - a.score || a.dist_m - b.dist_m);
  const best = list[0] || null;
  if (!best) return { best: null, highConfidence: false, candidates: list };
  const highConfidence =
    best.score >= LANDMARK_HIGH_CONFIDENCE_SCORE &&
    best.dist_m <= LANDMARK_RADIUS_M;
  return { best, highConfidence, candidates: list };
}

/**
 * Merge landmark OSM tags into the Nominatim address object for grounding.
 */
export function mergeLandmarkIntoAddress(address, landmark) {
  const addr = Object.assign({}, address || {});
  if (!landmark) return addr;
  const tags = landmark.osmTags || {};
  if (landmark.class === "leisure" || tags.leisure) {
    addr.leisure = landmark.name;
  }
  if (landmark.class === "tourism" || tags.tourism) {
    addr.tourism = landmark.name;
  }
  if (landmark.class === "historic" || tags.historic) {
    addr.historic = landmark.name;
  }
  if (landmark.class === "amenity" || tags.amenity) {
    // Keep amenity as the typed value when it is a type key; name goes separately
    if (tags.amenity && tags.amenity !== landmark.name) {
      addr.amenity = tags.amenity;
    } else if (landmark.type) {
      addr.amenity = landmark.type;
    }
  }
  if (tags.sport) addr.sport = tags.sport;
  if (tags.wikipedia) addr.wikipedia = tags.wikipedia;
  if (tags.wikidata) addr.wikidata = tags.wikidata;
  return addr;
}
