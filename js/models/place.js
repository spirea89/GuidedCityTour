/** Generic Place / POI model for buildings, museums, churches, etc. */

export const ENTITY_TYPES = {
  BUILDING: "building",
  STREET: "street",
  NEIGHBOURHOOD: "neighbourhood",
  MUSEUM: "museum",
  STATUE: "statue",
  CHURCH: "church",
  CASTLE: "castle",
  RESTAURANT: "restaurant",
  TRAIL: "trail",
  LANDMARK: "landmark",
  PLACE: "place",
  UNKNOWN: "unknown",
};

/**
 * Map Nominatim / OSM tags to a coarse entity type.
 */
export function inferEntityType(address = {}, focusKind = "") {
  if (focusKind === "street") return ENTITY_TYPES.STREET;
  if (focusKind === "area") return ENTITY_TYPES.NEIGHBOURHOOD;

  const tourism = String(address.tourism || "").toLowerCase();
  const historic = String(address.historic || "").toLowerCase();
  const amenity = String(address.amenity || "").toLowerCase();
  const building = String(address.building || "").toLowerCase();
  const leisure = String(address.leisure || "").toLowerCase();
  const manMade = String(address.man_made || "").toLowerCase();

  if (tourism === "museum" || amenity === "museum") return ENTITY_TYPES.MUSEUM;
  if (
    tourism === "attraction" ||
    tourism === "viewpoint" ||
    tourism === "yes"
  ) {
    return ENTITY_TYPES.LANDMARK;
  }
  if (
    historic === "monument" ||
    historic === "memorial" ||
    historic === "wayside_shrine" ||
    manMade === "statue"
  ) {
    return ENTITY_TYPES.STATUE;
  }
  if (
    historic === "church" ||
    amenity === "place_of_worship" ||
    building === "church" ||
    building === "cathedral" ||
    building === "chapel"
  ) {
    return ENTITY_TYPES.CHURCH;
  }
  if (
    historic === "castle" ||
    historic === "fort" ||
    building === "castle"
  ) {
    return ENTITY_TYPES.CASTLE;
  }
  if (
    amenity === "restaurant" ||
    amenity === "cafe" ||
    amenity === "fast_food" ||
    amenity === "pub" ||
    amenity === "bar"
  ) {
    return ENTITY_TYPES.RESTAURANT;
  }
  if (leisure === "track" || leisure === "path" || tourism === "trail") {
    return ENTITY_TYPES.TRAIL;
  }
  if (
    leisure === "stadium" ||
    building === "stadium" ||
    leisure === "sports_centre" ||
    leisure === "park" ||
    leisure === "garden" ||
    focusKind === "landmark"
  ) {
    return ENTITY_TYPES.LANDMARK;
  }
  if (focusKind === "house" || building) return ENTITY_TYPES.BUILDING;
  if (focusKind === "place") return ENTITY_TYPES.PLACE;
  return ENTITY_TYPES.UNKNOWN;
}

export function createPlace(partial = {}) {
  return {
    id: partial.id || "",
    name: partial.name || "",
    entityType: partial.entityType || ENTITY_TYPES.UNKNOWN,
    lat: Number(partial.lat) || 0,
    lng: Number(partial.lng) || 0,
    address: partial.address || {},
    displayName: partial.displayName || partial.name || "",
    identificationConfidence:
      typeof partial.identificationConfidence === "number"
        ? partial.identificationConfidence
        : 0,
    candidates: Array.isArray(partial.candidates) ? partial.candidates : [],
    nearbyAllowList: Array.isArray(partial.nearbyAllowList)
      ? partial.nearbyAllowList
      : [],
    focus: partial.focus || null,
  };
}

export function placeToJson(place) {
  return {
    id: place.id,
    name: place.name,
    entity_type: place.entityType,
    lat: place.lat,
    lng: place.lng,
    address: place.address,
    display_name: place.displayName,
    identification_confidence: place.identificationConfidence,
    candidates: place.candidates,
    nearby_allow_list: place.nearbyAllowList,
    focus: place.focus,
  };
}
