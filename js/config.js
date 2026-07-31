/** GuidedCityTour shared config - no secrets. */
export const APP_VERSION = "v2.1.1";
export const APP_VERSION_DATE = "2026-07-31";
export const PIPELINE_VERSION = "2.1.1";

export const DEFAULT_MAP = { lat: 48.8566, lng: 2.3522, zoom: 13 };

export const STORAGE_KEY = "gct_openai_api_key";
export const MODEL_STORAGE_KEY = "gct_openai_model";
export const MODEL_QUALITY = "gpt-4o";
export const MODEL_ECONOMY = "gpt-4o-mini";
export const DEFAULT_MODEL = MODEL_QUALITY;

export const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "Accept-Language":
    typeof navigator !== "undefined" ? navigator.language || "en" : "en",
};

/** ~700 m walking-radius box for nearby Nominatim lookups */
export const NEARBY_DELTA_DEG = 0.0065;
export const NEARBY_MAX_M = 700;

export const NEARBY_ALLOWED_CLASSES = {
  historic: true,
  tourism: true,
  amenity: true,
  building: true,
  leisure: true,
  office: true,
  natural: true,
  man_made: true,
};

export const NEARBY_SKIP_TYPES = {
  yes: true,
  residential: true,
  apartments: true,
  house: true,
  terrace: true,
  commercial: true,
  retail: true,
  industrial: true,
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
};

/** Below this → ask user to confirm before research/narration */
export const CONFIDENCE_CONFIRM_THRESHOLD = 0.55;

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_DB_NAME = "gct_cache_v2";
export const CACHE_STORE = "tours";

export const STORY_CATEGORIES = [
  { id: "history", label: "History" },
  { id: "architecture", label: "Architecture" },
  { id: "famous_people", label: "Personalities" },
  { id: "interesting_facts", label: "Interesting facts" },
  { id: "today", label: "Today" },
];

/**
 * Production: set tourEndpoint to a Worker URL to avoid browser CORS on
 * Responses/web_search and to use a server-held key.
 * Demo (GitHub Pages): leave null and use user localStorage key.
 */
export const API = {
  tourEndpoint: null,
  openAiBase: "https://api.openai.com/v1",
};

/**
 * Shared Supabase cache - leave empty in repo. Set at runtime / via Worker only.
 * Never commit service-role keys. Anon key only if RLS allows safe read of public cache.
 * @see docs/ai/supabase-cache.md
 */
export const SUPABASE = {
  url: "", // e.g. https://xxxx.supabase.co
  anonKey: "",
};

export const WEB_SEARCH_UNAVAILABLE_HINT =
  "Web research is unavailable from this browser (often CORS or API access). " +
  "GuidedCityTour will not invent historical facts. " +
  "A small Cloudflare Worker proxy is recommended - see docs/ai/backend-interfaces.md.";
