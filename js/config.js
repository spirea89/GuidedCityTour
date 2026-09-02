/** GuidedCityTour shared config - no secrets. */
export const APP_VERSION = "v2.2.4";
export const APP_VERSION_DATE = "2026-08-02";
export const PIPELINE_VERSION = "2.2.4";

export const DEFAULT_MAP = { lat: 48.8566, lng: 2.3522, zoom: 13 };

export const STORAGE_KEY = "gct_openai_api_key";
export const MODEL_STORAGE_KEY = "gct_openai_model";
/** OpenAI TTS voice preference: nova | shimmer | coral */
export const TTS_VOICE_STORAGE_KEY = "gct_openai_tts_voice";
/** "1" / "0" - mobile fit layout + pitched MapLibre when available */
export const MOBILE_FIT_STORAGE_KEY = "gct_mobile_fit";
/** Nearby POI chips under the mobile map (meters) */
export const MOBILE_NEARBY_CHIP_M = 150;
export const MODEL_QUALITY = "gpt-4o";
export const MODEL_ECONOMY = "gpt-4o-mini";
export const DEFAULT_MODEL = MODEL_QUALITY;

/**
 * OpenAI Text-to-Speech for museum-style Listen narration.
 * Prefer gpt-4o-mini-tts (instructions + natural guide tone); fall back to tts-1-hd.
 * Default voice: nova (calm, clear). Alternatives: shimmer, coral.
 */
export const OPENAI_TTS_MODEL_PREFERRED = "gpt-4o-mini-tts";
export const OPENAI_TTS_MODEL_FALLBACK = "tts-1-hd";
export const OPENAI_TTS_VOICES = ["nova", "shimmer", "coral"];
export const OPENAI_TTS_DEFAULT_VOICE = "nova";
/** Measured museum-guide pacing (API range 0.25–4.0). */
export const OPENAI_TTS_SPEED = 0.92;
/** Soft limit under the ~4096-char OpenAI TTS input cap. */
export const OPENAI_TTS_MAX_CHARS = 3600;
export const OPENAI_TTS_INSTRUCTIONS =
  "Speak as a calm museum city-guide narrator. Warm, clear English with measured pacing. Sound informative and welcoming, not theatrical or robotic.";

/** Photon (Komoot) — preferred browser geocoder; CORS-friendly. */
export const PHOTON_BASE = "https://photon.komoot.io";

/** Nominatim fallback only (public instance is often rate-limited / 429). */
export const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "Accept-Language":
    typeof navigator !== "undefined" ? navigator.language || "en" : "en",
};

/** ~700 m walking-radius box for nearby Nominatim lookups */
export const NEARBY_DELTA_DEG = 0.0065;
export const NEARBY_MAX_M = 700;

/**
 * Prefer named tourist/landmark POIs within this radius of a map click
 * over bare highway/road reverse-geocode results.
 */
export const LANDMARK_RADIUS_M = 150;
/** Fast first Overpass pass — tight radius for quick selection UI */
export const LANDMARK_RADIUS_FAST_M = 60;
/** Overpass server-side timeouts (seconds) for fast vs expand passes */
export const LANDMARK_OVERPASS_TIMEOUT_S = 8;
export const LANDMARK_OVERPASS_EXPAND_TIMEOUT_S = 12;
/** Soft client wait before showing reverse-only focus UI (ms) */
export const LANDMARK_UI_SOFT_WAIT_MS = 900;
/** Minimum score (type weight minus distance penalty) to auto-select a landmark */
export const LANDMARK_HIGH_CONFIDENCE_SCORE = 55;
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

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
 * Shared Supabase cache — publishable key is safe in client code (RLS protects data).
 * Never commit the service-role key.
 * @see docs/ai/supabase-cache.md
 */
export const SUPABASE = {
  url: "https://ifoybmzofjdgekvvrsot.supabase.co",
  anonKey: "sb_publishable_SUftoAM4bElr34PXERf_RQ_f9TZJcRl",
};

export const WEB_SEARCH_UNAVAILABLE_HINT =
  "Web research is unavailable from this browser (often CORS or API access). " +
  "GuidedCityTour will not invent historical facts. " +
  "A small Cloudflare Worker proxy is recommended - see docs/ai/backend-interfaces.md.";
