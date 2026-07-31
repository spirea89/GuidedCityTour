/** Lightweight schema constants + helpers for TourResponse. */

export const STATUS = {
  OK: "ok",
  NEEDS_CONFIRMATION: "needs_confirmation",
  UNIDENTIFIED: "unidentified",
  NO_HISTORY: "no_history",
  SOURCE_CONFLICT: "source_conflict",
  AMBIGUOUS_NAME: "ambiguous_name",
  OFFLINE: "offline",
  WEB_SEARCH_UNAVAILABLE: "web_search_unavailable",
  ERROR: "error",
};

export const VALID_STATUSES = new Set(Object.values(STATUS));

export const CLAIM_CATEGORIES = new Set([
  "history",
  "architecture",
  "famous_people",
  "interesting_facts",
  "today",
  "other",
]);

export const SOURCE_TIERS = new Set([
  "official",
  "academic",
  "museum",
  "news",
  "other",
]);

/** JSON Schema reminder embedded in prompts (compact). */
export const TOUR_RESPONSE_SCHEMA_HINT = `{
  "status": "ok|needs_confirmation|unidentified|no_history|source_conflict|ambiguous_name|offline|web_search_unavailable|error",
  "message": "string",
  "place": {
    "name": "string",
    "entity_type": "string",
    "lat": 0,
    "lng": 0,
    "identification_confidence": 0,
    "candidates": [{"name":"","entity_type":"","confidence":0,"reason":""}],
    "nearby_allow_list": [{"name":"","dist_m":0,"type":""}]
  },
  "research": {
    "mode": "web_search|cached|degraded|none",
    "queries": [],
    "sources_consulted": [{"title":"","url":"","publisher":"","tier":"official|academic|museum|news|other"}]
  },
  "claims": {
    "verified": [{"text":"","confidence":0,"category":"history","sources":[{"title":"","url":"","publisher":"","tier":"official"}]}],
    "uncertain": [],
    "legends": [],
    "unknown": ["string"]
  },
  "narration": {
    "adult": "string",
    "kids": "string",
    "sections": {
      "history": "",
      "architecture": "",
      "famous_people": "",
      "interesting_facts": "",
      "today": ""
    }
  },
  "citations": [{"title":"","url":"","publisher":"","tier":"official"}],
  "errors": [],
  "meta": { "pipeline_version": "2.1.4", "model": "", "research_available": false }
}`;
