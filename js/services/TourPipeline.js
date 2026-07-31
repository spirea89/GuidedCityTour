import { API, PIPELINE_VERSION, WEB_SEARCH_UNAVAILABLE_HINT } from "../config.js";
import { CacheService } from "./CacheService.js";
import { OpenAIService } from "./OpenAIService.js";
import { PromptBuilder } from "./PromptBuilder.js";
import { ResponseValidator } from "./ResponseValidator.js";
import { PlaceIdentifier } from "./PlaceIdentifier.js";
import { ResearchService } from "./ResearchService.js";
import { FactVerifier } from "./FactVerifier.js";
import { NarrationGenerator } from "./NarrationGenerator.js";
import { createTourResult } from "../models/tourResult.js";
import { STATUS } from "../schemas/tourResponseSchema.js";
import { placeToJson } from "../models/place.js";

/**
 * Orchestrates Identification → Research → Fact extraction → Narration → Validate → Cache.
 */
export class TourPipeline {
  constructor(options = {}) {
    this.openAi = options.openAi || new OpenAIService({
      apiKey: options.apiKey,
      model: options.model,
    });
    this.cache = options.cache || new CacheService();
    this.prompts = options.promptBuilder || new PromptBuilder();
    this.validator = options.validator || new ResponseValidator();
    this.identifier = options.identifier || new PlaceIdentifier();
    this.research = options.research || new ResearchService({
      openAi: this.openAi,
      promptBuilder: this.prompts,
      validator: this.validator,
    });
    this.verifier = options.verifier || new FactVerifier();
    this.narrator = options.narrator || new NarrationGenerator({
      openAi: this.openAi,
      promptBuilder: this.prompts,
      validator: this.validator,
    });
  }

  setApiKey(key) {
    this.openAi.setApiKey(key);
  }

  setModel(model) {
    this.openAi.setModel(model);
  }

  /**
   * @param {object} selection — map selection (lat, lng, address, focus, displayName, nearby)
   * @param {object} options — { categories, kidsMode, confirmedCandidate, skipCache, signal }
   */
  async run(selection, options = {}) {
    const categories = normalizeCategories(options.categories);
    const kidsMode = !!options.kidsMode;
    const focus = selection.focus || {};

    if (!navigator.onLine) {
      return createTourResult({
        status: STATUS.OFFLINE,
        message: "You appear to be offline. Reconnect to research this place.",
        place: {
          name: focus.label || "",
          entity_type: "unknown",
          lat: selection.lat,
          lng: selection.lng,
          identification_confidence: 0,
        },
        meta: { pipeline_version: PIPELINE_VERSION, research_available: false },
      });
    }

    // Production Worker path
    if (API.tourEndpoint) {
      const remote = await this.openAi.postTourEndpoint(API.tourEndpoint, {
        place: {
          lat: selection.lat,
          lng: selection.lng,
          focus,
          address: selection.address || {},
          nearby_allow_list: selection.nearbyPlaces || [],
          display_name: selection.displayName || "",
          confirmed_candidate: options.confirmedCandidate || null,
        },
        categories,
        kids_mode: kidsMode,
      });
      if (remote.ok && remote.raw) {
        const v = this.validator.validate(remote.raw);
        return v.normalized || remote.raw;
      }
      // fall through to client path if Worker fails
    }

    const cacheKey = this.cache.makeKey({
      lat: selection.lat,
      lng: selection.lng,
      focus: focus.id || focus.kind || "x",
      categories: categories.join(","),
      kids: kidsMode,
      v: PIPELINE_VERSION,
    });

    if (!options.skipCache && !options.confirmedCandidate) {
      const hit = await this.cache.get(cacheKey);
      if (hit && hit.status === STATUS.OK) {
        return {
          ...hit,
          meta: { ...(hit.meta || {}), cached: true },
        };
      }
    }

    // 1. Identification
    const idResult = this.identifier.identify({
      lat: selection.lat,
      lng: selection.lng,
      address: selection.address || {},
      displayName: selection.displayName || "",
      focus,
      nearbyPlaces: selection.nearbyPlaces || [],
      confirmedCandidate: options.confirmedCandidate || null,
    });

    if (idResult.status === STATUS.UNIDENTIFIED) {
      return createTourResult({
        status: STATUS.UNIDENTIFIED,
        message: idResult.message,
        place: placeToJson(idResult.place),
        meta: { pipeline_version: PIPELINE_VERSION },
      });
    }

    if (idResult.needsConfirmation && !options.confirmedCandidate) {
      return createTourResult({
        status: idResult.status,
        message: idResult.message,
        place: placeToJson(idResult.place),
        meta: { pipeline_version: PIPELINE_VERSION },
      });
    }

    const place = idResult.place;

    // 2. Research
    let researchResult;
    try {
      researchResult = await this.research.research(place, {
        categories,
        kidsMode,
      });
    } catch (err) {
      return createTourResult({
        status: STATUS.ERROR,
        message: (err && err.message) || "Research failed",
        place: placeToJson(place),
        errors: [String(err && err.message)],
        meta: { pipeline_version: PIPELINE_VERSION },
      });
    }

    if (!researchResult.ok && !researchResult.packet) {
      return createTourResult({
        status: researchResult.status || STATUS.WEB_SEARCH_UNAVAILABLE,
        message: researchResult.error || WEB_SEARCH_UNAVAILABLE_HINT,
        place: placeToJson(place),
        research: { mode: "degraded", queries: [], sources_consulted: [] },
        claims: {
          verified: [],
          uncertain: [],
          legends: [],
          unknown: ["Web research unavailable"],
        },
        narration: {
          adult:
            "Research could not run (" +
            (researchResult.error || "unavailable") +
            "). Historical facts will not be invented.",
          kids: "We could not look up real history right now.",
          sections: {},
        },
        meta: {
          pipeline_version: PIPELINE_VERSION,
          research_available: false,
          model: this.openAi.model,
        },
      });
    }

    const packet = researchResult.packet;

    // Ensure place fields from identifier win for coords/confidence
    if (!packet.place) packet.place = placeToJson(place);
    else {
      packet.place.lat = place.lat;
      packet.place.lng = place.lng;
      packet.place.identification_confidence = place.identificationConfidence;
      packet.place.nearby_allow_list = place.nearbyAllowList;
      if (!packet.place.name) packet.place.name = place.name;
    }

    // 3. Fact extraction
    const verifiedBundle = this.verifier.extract(packet, place, {});

    // 4. Narration
    const narration = await this.narrator.narrate(verifiedBundle, place, {
      categories,
      kidsMode,
    });

    // 5. Assemble + validate
    const assembled = createTourResult({
      status: verifiedBundle.status,
      message: verifiedBundle.message,
      place: placeToJson(place),
      research: verifiedBundle.research,
      claims: verifiedBundle.claims,
      narration,
      citations: verifiedBundle.citationsSeed || [],
      errors: packet.errors || [],
      meta: {
        pipeline_version: PIPELINE_VERSION,
        model: this.openAi.model,
        cached: false,
        generated_at: new Date().toISOString(),
        research_available: researchResult.mode === "web_search",
        ...(verifiedBundle.meta || {}),
      },
    });

    const validation = this.validator.validate(assembled);
    const result = validation.normalized || assembled;
    if (!validation.ok && result.status === STATUS.OK) {
      result.status = STATUS.ERROR;
      result.errors = (result.errors || []).concat(validation.errors);
      result.message = "Response failed validation: " + validation.errors.join("; ");
    }

    // 6. Cache successful grounded tours only
    if (result.status === STATUS.OK && result.claims.verified.length) {
      await this.cache.set(cacheKey, result);
    }

    return result;
  }
}

function normalizeCategories(cats) {
  const allowed = new Set([
    "history",
    "architecture",
    "famous_people",
    "interesting_facts",
    "today",
  ]);
  const list = Array.isArray(cats) ? cats : ["history"];
  const out = list.map(String).filter((c) => allowed.has(c));
  return out.length ? out : ["history"];
}
