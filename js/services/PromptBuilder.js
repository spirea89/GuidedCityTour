import { TOUR_RESPONSE_SCHEMA_HINT } from "../schemas/tourResponseSchema.js";
import { placeToJson } from "../models/place.js";
import { NEARBY_MAX_M } from "../config.js";

/**
 * Builds system / developer / user prompts for the tour pipeline.
 */
export class PromptBuilder {
  systemPrompt() {
    return (
      "You are GuidedCityTour’s research-and-narration engine for walking tours.\n\n" +
      "ROLE\n" +
      "- You reason over provided map data and (when available) web-search results.\n" +
      "- You are NOT the source of truth for history. Verified claims require sources.\n" +
      "- Prefer official / institutional sources: UNESCO, city government, museums,\n" +
      "  heritage registries, universities, tourism boards, national archives.\n" +
      "  Prefer primary or official pages over blogs, forums, and travel listicles.\n\n" +
      "HARD RULES\n" +
      "1. Never invent dates, people, events, architectural attributions, or nearby landmarks.\n" +
      "2. “Nearby / adjacent / a short walk” ONLY for names on the OSM allow-list " +
      "(or the selected road / neighbourhood / city fields).\n" +
      "3. Adult narration may use verified claims freely, and may include a clearly " +
      "labeled “Legends & local stories” section only from claims.legends.\n" +
      "4. Kids narration: verified claims only; simpler language; no invented stories.\n" +
      "5. Output MUST be a single JSON object matching the schema. No markdown fences.\n" +
      "6. If web search is unavailable, do not fill verified claims from model memory."
    );
  }

  developerPrompt(mode) {
    const schema = "\n\nSCHEMA:\n" + TOUR_RESPONSE_SCHEMA_HINT;
    if (mode === "research") {
      return (
        "Mode: RESEARCH + FACT EXTRACTION + NARRATE\n" +
        "Use web_search when the tool is available. Prefer authoritative domains.\n" +
        "Extract claims into verified | uncertain | legends | unknown.\n" +
        "Every verified claim MUST include at least one source {title,url,publisher,tier}.\n" +
        "If sources conflict on a material fact, set status source_conflict.\n" +
        "Then write narration.adult ONLY from verified (+ labeled legends section).\n" +
        "If kids_mode, also write narration.kids from verified only.\n" +
        "Fill narration.sections for requested categories when evidence exists." +
        schema
      );
    }
    if (mode === "degraded_no_search") {
      return (
        "Mode: DEGRADED — WEB SEARCH UNAVAILABLE\n" +
        "You must NOT invent historical facts from training memory.\n" +
        "Set status to web_search_unavailable.\n" +
        "claims.verified MUST be []. Put gaps in claims.unknown.\n" +
        "narration.adult may only describe OSM identity (name, type, address, allow-listed nearby) " +
        "and clearly state that historical research was unavailable.\n" +
        "narration.kids: brief honest note that we could not verify stories yet." +
        schema
      );
    }
    if (mode === "narrate") {
      return (
        "Mode: NARRATE FROM PROVIDED CLAIMS ONLY\n" +
        "Do not add facts. Write adult (+ kids if requested) and sections." +
        schema
      );
    }
    return "Mode: " + mode + schema;
  }

  userTourPrompt(place, options = {}) {
    const categories = options.categories || ["history"];
    const kidsMode = !!options.kidsMode;
    const researchMode = options.researchMode || "web_search";
    const nearby = place.nearbyAllowList || [];
    const nearbyText =
      nearby.length === 0
        ? "(EMPTY ALLOW-LIST — do NOT invent landmarks within ~" +
          NEARBY_MAX_M +
          " m.)"
        : nearby
            .map(
              (p, i) =>
                "  " +
                (i + 1) +
                ") " +
                p.name +
                " — " +
                p.dist_m +
                " m" +
                (p.type ? " [" + p.type + "]" : "")
            )
            .join("\n");

    const focus = place.focus || {};
    return (
      "Place context (OpenStreetMap / Nominatim — identity source):\n" +
      JSON.stringify(placeToJson(place), null, 2) +
      "\n\nFocus: " +
      (focus.kind || "place") +
      " — " +
      (focus.label || place.name) +
      "\n\nNearby allow-list (ONLY these may be called nearby):\n" +
      nearbyText +
      "\n\nCategories: " +
      categories.join(", ") +
      "\nKids mode: " +
      (kidsMode ? "true" : "false") +
      "\nResearch mode: " +
      researchMode +
      "\n\nReturn JSON matching TourResponse schema. Deduplicate citations[] from verified sources."
    );
  }

  researchQueries(place, categories = []) {
    const name = place.name || "";
    const city =
      (place.address &&
        (place.address.city ||
          place.address.town ||
          place.address.village ||
          place.address.municipality)) ||
      "";
    const base = [name, city].filter(Boolean).join(" ");
    const queries = [];
    if (base) {
      queries.push(base + " history heritage");
      if (categories.includes("architecture")) {
        queries.push(base + " architecture building style");
      }
      if (categories.includes("famous_people")) {
        queries.push(base + " notable people residents");
      }
      if (categories.includes("today")) {
        queries.push(base + " official tourism");
      }
    }
    return queries.slice(0, 4);
  }
}
