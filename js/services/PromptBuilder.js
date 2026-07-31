import { TOUR_RESPONSE_SCHEMA_HINT } from "../schemas/tourResponseSchema.js";
import { placeToJson } from "../models/place.js";
import { NEARBY_MAX_M } from "../config.js";

/**
 * Builds system / developer / user prompts for the tour pipeline.
 */
export class PromptBuilder {
  systemPrompt() {
    return (
      "You are GuidedCityTour's research-and-narration engine for walking tours.\n\n" +
      "ROLE\n" +
      "- You reason over provided map data and (when available) web-search results.\n" +
      "- You are NOT the source of truth for history. Verified claims require sources.\n" +
      "- Prefer official / institutional sources: UNESCO, city government, museums,\n" +
      "  heritage registries, universities, tourism boards, national archives.\n" +
      "  Prefer primary or official pages over blogs, forums, and travel listicles.\n\n" +
      "HARD RULES\n" +
      "1. Never invent dates, people, events, architectural attributions, or nearby landmarks.\n" +
      '2. "Nearby / adjacent / a short walk" ONLY for names on the OSM allow-list ' +
      "(or the selected road / neighbourhood / city fields).\n" +
      "3. Adult narration may use verified claims freely, and may include a clearly " +
      'labeled "Legends & local stories" section only from claims.legends.\n' +
      "4. Kids narration: verified claims only; simpler language; no invented stories.\n" +
      "5. Write ALL narration text in English (narration.adult, narration.kids, " +
      "narration.sections, and any spoken guide text), regardless of the place's " +
      "country or local language. Proper nouns and place names may stay in their " +
      "local form.\n" +
      "6. Category sections (History, Architecture, Personalities/famous_people, " +
      "Interesting facts, Today, Kids) must contain ONLY verified facts for that topic - " +
      "never pad with guesses.\n" +
      "7. Output MUST be a single JSON object matching the schema. No markdown fences.\n" +
      "8. If web search is unavailable, do not fill verified claims from model memory."
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
        "Fill narration.sections for requested categories when evidence exists " +
        "(history, architecture, famous_people/Personalities, interesting_facts, today).\n" +
        "Omit empty sections rather than inventing content.\n" +
        "All narration fields MUST be in English (even if the place is in a non-English country)." +
        schema
      );
    }
    if (mode === "degraded_no_search") {
      return (
        "Mode: DEGRADED - WEB SEARCH UNAVAILABLE\n" +
        "You must NOT invent historical facts from training memory.\n" +
        "Set status to web_search_unavailable.\n" +
        "claims.verified MUST be []. Put gaps in claims.unknown.\n" +
        "narration.adult may only describe OSM identity (name, type, address, allow-listed nearby) " +
        "and clearly state that historical research was unavailable.\n" +
        "narration.kids: brief honest note that we could not verify stories yet.\n" +
        "Write both narrations in English." +
        schema
      );
    }
    if (mode === "narrate") {
      return (
        "Mode: NARRATE FROM PROVIDED CLAIMS ONLY\n" +
        "Do not add facts. Write adult (+ kids if requested) and sections.\n" +
        "All narration text MUST be in English." +
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
        ? "(EMPTY ALLOW-LIST - do NOT invent landmarks within ~" +
          NEARBY_MAX_M +
          " m.)"
        : nearby
            .map(
              (p, i) =>
                "  " +
                (i + 1) +
                ") " +
                p.name +
                " - " +
                p.dist_m +
                " m" +
                (p.type ? " [" + p.type + "]" : "")
            )
            .join("\n");

    const focus = place.focus || {};
    const landmarkNote =
      focus.kind === "landmark"
        ? "\nIMPORTANT: The selected focus is a named landmark/POI (" +
          (focus.label || place.name) +
          "). Research and narrate THIS landmark - not a nearby street or house number, " +
          "unless the user explicitly chose street/house focus.\n" +
          (focus.type || focus.class
            ? "OSM type: " +
              [focus.class, focus.type].filter(Boolean).join("/") +
              "\n"
            : "")
        : "";
    return (
      "Place context (OpenStreetMap / Nominatim - identity source):\n" +
      JSON.stringify(placeToJson(place), null, 2) +
      "\n\nFocus: " +
      (focus.kind || "place") +
      " - " +
      (focus.label || place.name) +
      landmarkNote +
      "\nNearby allow-list (ONLY these may be called nearby):\n" +
      nearbyText +
      "\n\nCategories: " +
      categories.join(", ") +
      "\nKids mode: " +
      (kidsMode ? "true" : "false") +
      "\nResearch mode: " +
      researchMode +
      "\nLanguage: English - write narration.adult, narration.kids, and narration.sections in English " +
      "regardless of the place's country or local language.\n" +
      "\nReturn JSON matching TourResponse schema. Deduplicate citations[] from verified sources."
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
      if (categories.includes("famous_people") || categories.includes("personalities")) {
        queries.push(base + " notable people residents personalities");
      }
      if (categories.includes("today")) {
        queries.push(base + " official tourism");
      }
    }
    return queries.slice(0, 4);
  }
}
