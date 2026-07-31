import {
  createPlace,
  inferEntityType,
  ENTITY_TYPES,
} from "../models/place.js";
import { CONFIDENCE_CONFIRM_THRESHOLD } from "../config.js";
import { STATUS } from "../schemas/tourResponseSchema.js";

/**
 * Identifies a Place/POI from OSM reverse-geocode + focus selection.
 * Does not invent history — identity only.
 *
 * Architecture alias: BuildingIdentifier (docs / SOLID naming).
 * Handles buildings and any Place/POI entity type.
 */
export class PlaceIdentifier {
  /**
   * @param {object} input
   * @param {number} input.lat
   * @param {number} input.lng
   * @param {object} [input.address]
   * @param {string} [input.displayName]
   * @param {object} [input.focus]
   * @param {array} [input.nearbyPlaces]
   * @param {object} [input.confirmedCandidate] — user-confirmed name override
   */
  identify(input = {}) {
    const address = input.address || {};
    const focus = input.focus || {};
    const nearby = Array.isArray(input.nearbyPlaces) ? input.nearbyPlaces : [];

    const road =
      address.road ||
      address.pedestrian ||
      address.footway ||
      address.path ||
      "";
    const houseNumber = address.house_number || address.housenumber || "";
    const neighbourhood =
      address.neighbourhood ||
      address.suburb ||
      address.quarter ||
      address.city_district ||
      address.district ||
      "";
    const city =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      "";

    const candidates = [];
    const namedPoi =
      address.tourism ||
      address.historic ||
      address.amenity ||
      address.building ||
      "";

    if (input.confirmedCandidate && input.confirmedCandidate.name) {
      candidates.push({
        name: input.confirmedCandidate.name,
        entity_type:
          input.confirmedCandidate.entity_type ||
          inferEntityType(address, focus.kind),
        confidence: 0.95,
        reason: "Confirmed by user",
      });
    }

    if (focus.kind === "house" && road && houseNumber) {
      candidates.push({
        name: road + " " + houseNumber + (city ? ", " + city : ""),
        entity_type: inferEntityType(address, "house"),
        confidence: namedPoi ? 0.75 : 0.62,
        reason: "House number + road from Nominatim",
      });
    }
    if (focus.kind === "street" && road) {
      candidates.push({
        name: road + (city ? ", " + city : ""),
        entity_type: ENTITY_TYPES.STREET,
        confidence: 0.8,
        reason: "Street from Nominatim",
      });
    }
    if (focus.kind === "area" && (neighbourhood || city)) {
      candidates.push({
        name: (neighbourhood || city) + (city && neighbourhood ? ", " + city : ""),
        entity_type: ENTITY_TYPES.NEIGHBOURHOOD,
        confidence: neighbourhood ? 0.78 : 0.65,
        reason: "Neighbourhood / area from Nominatim",
      });
    }

    if (focus.label) {
      const exists = candidates.some(
        (c) => c.name.toLowerCase() === String(focus.label).toLowerCase()
      );
      if (!exists) {
        candidates.push({
          name: focus.label,
          entity_type: inferEntityType(address, focus.kind),
          confidence: 0.58,
          reason: "Selected focus label",
        });
      }
    }

    if (input.displayName && candidates.length === 0) {
      candidates.push({
        name: String(input.displayName).split(",")[0].trim(),
        entity_type: inferEntityType(address, focus.kind),
        confidence: 0.45,
        reason: "Display name fallback",
      });
    }

    // Deduplicate by name
    const seen = new Set();
    const uniq = [];
    for (const c of candidates) {
      const k = c.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(c);
    }

    const best = uniq[0] || null;
    const confidence = best ? best.confidence : 0;
    const ambiguous =
      uniq.length >= 2 &&
      Math.abs((uniq[0].confidence || 0) - (uniq[1].confidence || 0)) < 0.12;

    let status = STATUS.OK;
    if (!best || !best.name) {
      status = STATUS.UNIDENTIFIED;
    } else if (
      !input.confirmedCandidate &&
      (confidence < CONFIDENCE_CONFIRM_THRESHOLD || ambiguous)
    ) {
      status = ambiguous ? STATUS.AMBIGUOUS_NAME : STATUS.NEEDS_CONFIRMATION;
    }

    const place = createPlace({
      id:
        "osm:" +
        Number(input.lat).toFixed(5) +
        "," +
        Number(input.lng).toFixed(5) +
        ":" +
        (focus.id || focus.kind || "x"),
      name: best ? best.name : "",
      entityType: best
        ? best.entity_type
        : inferEntityType(address, focus.kind),
      lat: input.lat,
      lng: input.lng,
      address,
      displayName: input.displayName || (best && best.name) || "",
      identificationConfidence: confidence,
      candidates: uniq,
      nearbyAllowList: nearby.map((p) => ({
        name: p.name,
        dist_m: p.dist_m,
        type: p.type || "",
      })),
      focus,
    });

    return {
      status,
      place,
      needsConfirmation:
        status === STATUS.NEEDS_CONFIRMATION ||
        status === STATUS.AMBIGUOUS_NAME,
      message:
        status === STATUS.UNIDENTIFIED
          ? "Could not identify a named place at this pin. Try searching or moving the marker."
          : status === STATUS.AMBIGUOUS_NAME
            ? "Several names look plausible — confirm which place you mean before we research history."
            : status === STATUS.NEEDS_CONFIRMATION
              ? "Identification confidence is low. Confirm the place name before research."
              : "Place identified from map data.",
    };
  }
}

/** Architecture / SOLID alias — same class as PlaceIdentifier. */
export { PlaceIdentifier as BuildingIdentifier };
