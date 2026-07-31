/**
 * GuidedCityTour app shell - map, geolocation, OSM, TTS, API key modal.
 * Stories go through TourPipeline (identify -> research -> verify -> narrate).
 */
import {
  APP_VERSION,
  APP_VERSION_DATE,
  DEFAULT_MAP,
  STORAGE_KEY,
  MODEL_STORAGE_KEY,
  MOBILE_FIT_STORAGE_KEY,
  MOBILE_NEARBY_CHIP_M,
  MODEL_QUALITY,
  MODEL_ECONOMY,
  DEFAULT_MODEL,
  NOMINATIM_HEADERS,
  NEARBY_DELTA_DEG,
  NEARBY_MAX_M,
  NEARBY_ALLOWED_CLASSES,
  NEARBY_SKIP_TYPES,
  STORY_CATEGORIES,
} from "./config.js";
import { TourPipeline } from "./services/TourPipeline.js";
import { StoryRenderer } from "./ui/storyRenderer.js";
import {
  fetchNearbyLandmarks,
  landmarkFromNominatimHit,
  pickPreferredLandmark,
  mergeLandmarkIntoAddress,
  isLandmarkClassType,
} from "./services/LandmarkFinder.js";
import {
  createMobileMap,
  loadMapLibreFromCdn,
} from "./services/MobileMap.js";

const map = L.map("map", { zoomControl: true }).setView(
  [DEFAULT_MAP.lat, DEFAULT_MAP.lng],
  DEFAULT_MAP.zoom
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

let marker = null;
let youAreHereMarker = null;
let currentSelection = null;
let reverseAbort = null;
let nearbyAbort = null;
let chipsAbort = null;
let speechState = "idle";
let preferredVoice = null;
let lastSpeakText = "";
let pendingConfirm = null;
let speechToken = 0;
let speechTimer = null;
let speechQueue = [];
let speechIndex = 0;
let speechPausedBetween = false;
let mobileFit = false;
let mobileMap = null;
let mobileMapReady = false;
let mobileMapFailed = false;
let lastUserLat = null;
let lastUserLng = null;

const els = {
  placeholder: document.getElementById("panel-placeholder"),
  content: document.getElementById("panel-content"),
  embed: document.getElementById("gmaps-embed"),
  placeName: document.getElementById("place-name"),
  lat: document.getElementById("coord-lat"),
  lng: document.getElementById("coord-lng"),
  streetView: document.getElementById("streetview-btn"),
  gmaps: document.getElementById("gmaps-btn"),
  form: document.getElementById("search-form"),
  input: document.getElementById("search-input"),
  btn: document.getElementById("search-btn"),
  status: document.getElementById("search-status"),
  locateBtn: document.getElementById("locate-btn"),
  compassBtn: document.getElementById("compass-btn"),
  mobileToggle: document.getElementById("mobile-toggle"),
  mobileFitInput: document.getElementById("mobile-fit-input"),
  mapStack: document.getElementById("map-stack"),
  mapGl: document.getElementById("map-gl"),
  nearbyChips: document.getElementById("nearby-chips"),
  settingsBtn: document.getElementById("settings-btn"),
  keyDot: document.getElementById("key-dot"),
  keyModal: document.getElementById("key-modal"),
  apiKeyInput: document.getElementById("api-key-input"),
  modelQuality: document.getElementById("model-quality"),
  modelEconomy: document.getElementById("model-economy"),
  saveKeyBtn: document.getElementById("save-key-btn"),
  clearKeyBtn: document.getElementById("clear-key-btn"),
  closeKeyBtn: document.getElementById("close-key-btn"),
  geoBanner: document.getElementById("geo-banner"),
  focusOptions: document.getElementById("focus-options"),
  focusConfirm: document.getElementById("focus-confirm"),
  reverseStatus: document.getElementById("reverse-status"),
  generateBtn: document.getElementById("generate-btn"),
  storyBlock: document.getElementById("story-block"),
  storyLoading: document.getElementById("story-loading"),
  storyError: document.getElementById("story-error"),
  storyText: document.getElementById("story-text"),
  speechControls: document.getElementById("speech-controls"),
  speechPlayBtn: document.getElementById("speech-play-btn"),
  speechPauseBtn: document.getElementById("speech-pause-btn"),
  speechStopBtn: document.getElementById("speech-stop-btn"),
  speechHint: document.getElementById("speech-hint"),
  appVersion: document.getElementById("app-version"),
  panelVersion: document.getElementById("panel-version"),
  categoryOptions: document.getElementById("category-options"),
  kidsMode: document.getElementById("kids-mode"),
  citationsBlock: document.getElementById("citations-block"),
  confirmBlock: document.getElementById("confirm-block"),
  claimsMeta: document.getElementById("claims-meta"),
};

const pipeline = new TourPipeline({
  apiKey: getApiKey(),
  model: getStoryModel(),
});
const renderer = new StoryRenderer(els);

if (els.appVersion) els.appVersion.textContent = APP_VERSION;
if (els.panelVersion) {
  els.panelVersion.textContent =
    "GuidedCityTour " + APP_VERSION + " | " + APP_VERSION_DATE;
}

renderCategoryOptions();

function renderCategoryOptions() {
  if (!els.categoryOptions) return;
  els.categoryOptions.innerHTML = "";
  STORY_CATEGORIES.forEach((cat, index) => {
    const label = document.createElement("label");
    label.className = "category-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "story-category";
    input.value = cat.id;
    input.checked = index === 0 || cat.id === "history";
    if (cat.id === "architecture" || cat.id === "interesting_facts") {
      input.checked = true;
    }
    const span = document.createElement("span");
    span.textContent = cat.label;
    label.appendChild(input);
    label.appendChild(span);
    els.categoryOptions.appendChild(label);
  });
}

function getSelectedCategories() {
  if (!els.categoryOptions) return ["history"];
  const boxes = els.categoryOptions.querySelectorAll(
    'input[name="story-category"]:checked'
  );
  const out = [];
  boxes.forEach((b) => out.push(b.value));
  return out.length ? out : ["history"];
}

function isKidsMode() {
  return !!(els.kidsMode && els.kidsMode.checked);
}

function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Strip URLs, markdown links, and citation/source sections from narration
 * before TTS. Displayed story text can still show citations; only spoken text
 * is cleaned so the audio guide does not read "https" or reference lists aloud.
 */
function cleanSpokenText(raw) {
  if (!raw) return "";
  let text = String(raw);

  // Drop Sources / Citations / References blocks and everything after.
  text = text.replace(
    /\n\s*(?:#{1,6}\s*)?(?:sources?|citations?|references?|further reading|bibliography)\s*:?\s*\n[\s\S]*$/i,
    "\n"
  );
  // Same headings when they appear mid-string without a leading newline.
  text = text.replace(
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:sources?|citations?|references?|further reading|bibliography)\s*:?\s*$/gim,
    ""
  );

  // Markdown links: keep visible label, drop URL.
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Full URLs (with or without scheme).
  text = text.replace(/https?:\/\/[^\s<>\[\]()"'`]+/gi, " ");
  text = text.replace(/\bwww\.[^\s<>\[\]()"'`]+/gi, " ");

  // Bare citation-style domains on their own line (e.g. en.wikipedia.org/wiki/...).
  text = text.replace(
    /(?:^|\n)\s*[-\u2022*]?\s*(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|uk|fr|de|eu|info)(?:\/[^\s]*)?\s*(?=\n|$)/gim,
    "\n"
  );

  // Inline bare domains that look like leftover citations (path present).
  text = text.replace(
    /\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io)\/[^\s<>\[\]()"'`,;]+/gi,
    " "
  );

  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^[-*\u2022]\s+/gm, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** GuidedCityTour always narrates in English regardless of locale / place. */
const SPEECH_LANG = "en-US";
/** Museum audio-guide pacing: calm, slightly slow, steady. */
const SPEECH_RATE = 0.88;
const SPEECH_PITCH = 0.95;
const SPEECH_VOLUME = 1;
const SPEECH_GAP_MS = 340;

/** Prefer calm, clear English system voices when available. */
const PREFERRED_VOICE_NEEDLES = [
  ["google uk english female", 34],
  ["microsoft aria", 32],
  ["samantha", 32],
  ["daniel", 30],
  ["google uk english male", 30],
  ["microsoft jenny", 30],
  ["microsoft guy", 28],
  ["google us english", 28],
  ["microsoft davis", 26],
  ["microsoft sona", 26],
  ["karen", 24],
  ["moira", 24],
  ["serena", 22],
  ["oliver", 20],
  ["alex", 18],
];

function scoreMuseumVoice(v) {
  const lang = (v.lang || "").toLowerCase().replace("_", "-");
  const name = (v.name || "").toLowerCase();
  let score = 0;
  if (lang === "en-us" || lang.startsWith("en-us-")) score += 40;
  else if (lang === "en-gb" || lang.startsWith("en-gb-")) score += 38;
  else if (lang === "en" || lang.startsWith("en-")) score += 20;
  else return -1;

  for (let i = 0; i < PREFERRED_VOICE_NEEDLES.length; i++) {
    if (name.indexOf(PREFERRED_VOICE_NEEDLES[i][0]) !== -1) {
      score += PREFERRED_VOICE_NEEDLES[i][1];
      break;
    }
  }
  if (/\b(female|woman)\b/.test(name)) score += 4;
  if (v.localService) score += 5;
  if (
    /novelty|whisper|zarvox|trinoids|bad news|pipe organ|cellos|bubbles|bahh|boing/.test(
      name
    )
  ) {
    score -= 50;
  }
  return score;
}

function refreshPreferredVoice() {
  if (!speechSupported()) return;
  const voices = window.speechSynthesis.getVoices() || [];
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < voices.length; i++) {
    const score = scoreMuseumVoice(voices[i]);
    if (score > bestScore) {
      bestScore = score;
      best = voices[i];
    }
  }
  preferredVoice = bestScore > 0 ? best : null;
}

/** Split narration into paragraph/sentence chunks for guide-like pauses. */
function splitSpokenChunks(text) {
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map(function (p) {
      return p.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
  const chunks = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p];
    const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [para];
    let buf = "";
    for (let s = 0; s < sentences.length; s++) {
      const piece = sentences[s].trim();
      if (!piece) continue;
      if (buf && (buf + " " + piece).length > 280) {
        chunks.push(buf);
        buf = piece;
      } else {
        buf = buf ? buf + " " + piece : piece;
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks.length ? chunks : [String(text).trim()];
}

function updateSpeechUi() {
  const hasStory = !!(lastSpeakText || "").trim();
  const supported = speechSupported();
  els.speechControls.classList.toggle(
    "visible",
    hasStory || speechState !== "idle"
  );

  if (!supported) {
    els.speechPlayBtn.disabled = true;
    els.speechPauseBtn.disabled = true;
    els.speechStopBtn.disabled = true;
    els.speechHint.textContent =
      "Narration is not supported in this browser.";
    return;
  }

  els.speechPlayBtn.disabled = !hasStory || speechState === "speaking";
  els.speechStopBtn.disabled = speechState === "idle";
  const canPause =
    typeof window.speechSynthesis.pause === "function" &&
    typeof window.speechSynthesis.resume === "function";

  if (speechState === "speaking") {
    els.speechPauseBtn.disabled = !canPause;
    els.speechPauseBtn.textContent = "Pause";
    els.speechHint.textContent = "Reading the story aloud...";
    els.speechHint.classList.remove("pulse");
  } else if (speechState === "paused") {
    els.speechPlayBtn.disabled = true;
    els.speechPauseBtn.disabled = !canPause;
    els.speechPauseBtn.textContent = "Resume";
    els.speechHint.textContent = "Paused - resume or stop narration.";
  } else {
    els.speechPauseBtn.disabled = true;
    els.speechPauseBtn.textContent = "Pause";
    if (hasStory) {
      els.speechHint.textContent = "Tap Listen for a guided narration";
      els.speechHint.classList.add("pulse");
    } else {
      els.speechHint.textContent = "";
      els.speechHint.classList.remove("pulse");
    }
  }
}

function clearSpeechTimer() {
  if (speechTimer) {
    clearTimeout(speechTimer);
    speechTimer = null;
  }
}

function stopSpeech() {
  speechToken += 1;
  speechPausedBetween = false;
  speechQueue = [];
  speechIndex = 0;
  clearSpeechTimer();
  if (speechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {
      /* ignore */
    }
  }
  speechState = "idle";
  updateSpeechUi();
}

function makeGuideUtterance(chunk) {
  const utter = new SpeechSynthesisUtterance(chunk);
  utter.lang = SPEECH_LANG;
  if (preferredVoice) {
    utter.voice = preferredVoice;
  }
  utter.rate = SPEECH_RATE;
  utter.pitch = SPEECH_PITCH;
  utter.volume = SPEECH_VOLUME;
  return utter;
}

function speakNextChunk(token) {
  if (token !== speechToken || speechPausedBetween) return;
  if (speechIndex >= speechQueue.length) {
    speechState = "idle";
    updateSpeechUi();
    return;
  }

  const utter = makeGuideUtterance(speechQueue[speechIndex]);
  utter.onstart = () => {
    if (token !== speechToken) return;
    speechState = "speaking";
    updateSpeechUi();
  };
  utter.onend = () => {
    if (token !== speechToken) return;
    speechIndex += 1;
    if (speechIndex >= speechQueue.length) {
      speechState = "idle";
      updateSpeechUi();
      return;
    }
    speechTimer = setTimeout(() => {
      speechTimer = null;
      if (token !== speechToken || speechPausedBetween) return;
      speakNextChunk(token);
    }, SPEECH_GAP_MS);
  };
  utter.onerror = () => {
    if (token !== speechToken) return;
    speechState = "idle";
    updateSpeechUi();
  };

  try {
    window.speechSynthesis.speak(utter);
  } catch (_) {
    speechState = "idle";
    els.speechHint.textContent = "Could not start narration. Try again.";
    updateSpeechUi();
  }
}

function speakStory() {
  if (!speechSupported()) {
    updateSpeechUi();
    return;
  }
  const spoken = cleanSpokenText(lastSpeakText);
  if (!spoken) return;

  stopSpeech();
  refreshPreferredVoice();
  speechQueue = splitSpokenChunks(spoken);
  speechIndex = 0;
  speechPausedBetween = false;
  const token = ++speechToken;

  setTimeout(() => {
    if (token !== speechToken) return;
    try {
      speechState = "speaking";
      updateSpeechUi();
      speakNextChunk(token);
    } catch (_) {
      speechState = "idle";
      els.speechHint.textContent = "Could not start narration. Try again.";
      updateSpeechUi();
    }
  }, 40);
}

function togglePauseSpeech() {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  if (speechState === "speaking") {
    if (speechTimer) {
      clearSpeechTimer();
      speechPausedBetween = true;
      speechState = "paused";
    } else {
      try {
        synth.pause();
        speechState = "paused";
      } catch (_) {
        stopSpeech();
        return;
      }
    }
  } else if (speechState === "paused") {
    speechPausedBetween = false;
    if (!synth.speaking && !synth.paused) {
      speechState = "speaking";
      speakNextChunk(speechToken);
    } else {
      try {
        synth.resume();
        speechState = "speaking";
      } catch (_) {
        stopSpeech();
        return;
      }
    }
  }
  updateSpeechUi();
}

function getApiKey() {
  try {
    return (localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch (_) {
    return "";
  }
}

function setApiKey(key) {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
  pipeline.setApiKey(getApiKey());
  updateKeyUi();
}

function getStoryModel() {
  try {
    const stored = (localStorage.getItem(MODEL_STORAGE_KEY) || "").trim();
    if (stored === MODEL_QUALITY || stored === MODEL_ECONOMY) return stored;
  } catch (_) {
    /* ignore */
  }
  return DEFAULT_MODEL;
}

function setStoryModel(model) {
  const next = model === MODEL_ECONOMY ? MODEL_ECONOMY : MODEL_QUALITY;
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, next);
  } catch (_) {
    /* ignore */
  }
  pipeline.setModel(next);
  syncModelRadios();
}

function syncModelRadios() {
  const model = getStoryModel();
  if (els.modelQuality) els.modelQuality.checked = model === MODEL_QUALITY;
  if (els.modelEconomy) els.modelEconomy.checked = model === MODEL_ECONOMY;
}

function updateKeyUi() {
  els.keyDot.classList.toggle("set", !!getApiKey());
  updateGenerateButton();
}

function openKeyModal(force) {
  els.apiKeyInput.value = getApiKey();
  syncModelRadios();
  els.keyModal.classList.add("open");
  if (force || !getApiKey()) {
    setTimeout(() => els.apiKeyInput.focus(), 50);
  }
}

function closeKeyModal() {
  els.keyModal.classList.remove("open");
  els.apiKeyInput.value = "";
}

function formatCoord(n) {
  return Number(n).toFixed(6);
}

function setStatus(msg, isError) {
  els.status.textContent = msg || "";
  els.status.classList.toggle("error", !!isError);
}

function setGeoBanner(msg, kind) {
  if (!msg) {
    els.geoBanner.hidden = true;
    els.geoBanner.textContent = "";
    els.geoBanner.classList.remove("error", "ok");
    return;
  }
  els.geoBanner.hidden = false;
  els.geoBanner.textContent = msg;
  els.geoBanner.classList.toggle("error", kind === "error");
  els.geoBanner.classList.toggle("ok", kind === "ok");
}

function clearStory() {
  stopSpeech();
  lastSpeakText = "";
  pendingConfirm = null;
  renderer.clear();
  els.speechControls.classList.remove("visible");
  updateSpeechUi();
}

function updateGenerateButton() {
  const hasKey = !!getApiKey();
  const hasFocus =
    currentSelection &&
    currentSelection.focus &&
    currentSelection.focus.label;
  els.generateBtn.disabled = !(hasKey && hasFocus);
  if (!hasKey) {
    els.generateBtn.title = "Add your OpenAI API key to generate a story";
  } else if (!hasFocus) {
    els.generateBtn.title = "Select a story focus first";
  } else {
    els.generateBtn.title =
      "Run grounded research + narration for this place";
  }
}

function showLocation(lat, lng, label, options) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  const opts = options || {};

  if (marker) marker.setLatLng([latNum, lngNum]);
  else marker = L.marker([latNum, lngNum]).addTo(map);

  if (mobileMap && mobileMapReady) {
    mobileMap.placeSelection(latNum, lngNum);
  }

  els.lat.textContent = formatCoord(latNum);
  els.lng.textContent = formatCoord(lngNum);
  els.embed.src =
    "https://maps.google.com/maps?q=" +
    latNum +
    "," +
    lngNum +
    "&z=16&output=embed";
  els.streetView.href =
    "https://www.google.com/maps/@" +
    latNum +
    "," +
    lngNum +
    ",3a,90y,0h,90t/data=!3m6!1e1";
  els.gmaps.href =
    "https://www.google.com/maps/search/?api=1&query=" +
    latNum +
    "," +
    lngNum;

  if (label) {
    els.placeName.textContent = label;
    els.placeName.hidden = false;
  } else {
    els.placeName.textContent = "";
    els.placeName.hidden = true;
  }

  els.placeholder.classList.add("hidden");
  els.content.classList.add("active");

  if (nearbyAbort) {
    nearbyAbort.abort();
    nearbyAbort = null;
  }

  currentSelection = {
    lat: latNum,
    lng: lngNum,
    displayName: label || "",
    address: null,
    focus: null,
    options: [],
    nearbyPlaces: [],
    preferredLandmark: opts.preferredLandmark || null,
  };

  els.focusOptions.innerHTML = "";
  els.focusConfirm.classList.remove("visible");
  els.focusConfirm.textContent = "";
  els.reverseStatus.textContent = "Looking up place...";
  els.reverseStatus.classList.remove("error");
  clearStory();
  updateGenerateButton();
  reverseGeocode(latNum, lngNum, label, opts.preferredLandmark || null);

  if (mobileFit) {
    refreshNearbyChips(latNum, lngNum);
  }
}

function buildFocusOptions(address, displayName, landmark, highConfidence) {
  const options = [];
  const road =
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.path ||
    "";
  const house = address.house_number || address.housenumber || "";
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

  if (landmark && landmark.name && highConfidence) {
    options.push({
      id: "landmark",
      title: "This landmark",
      detail:
        landmark.name +
        (landmark.typeLabel ? " (" + landmark.typeLabel + ")" : ""),
      label: landmark.name,
      kind: "landmark",
      entityHint: landmark.entityType || "",
      osmTags: landmark.osmTags || {},
      type: landmark.type || "",
      class: landmark.class || "",
    });
  }

  if (house && road) {
    options.push({
      id: "house",
      title: "This house / building",
      detail: road + " " + house + (city ? ", " + city : ""),
      label: road + " " + house + (city ? ", " + city : ""),
      kind: "house",
    });
  }
  if (road) {
    options.push({
      id: "street",
      title: "This street",
      detail: road + (city ? ", " + city : ""),
      label: road + (city ? ", " + city : ""),
      kind: "street",
    });
  }
  if (neighbourhood) {
    options.push({
      id: "area",
      title: "This neighbourhood / area",
      detail: neighbourhood + (city ? ", " + city : ""),
      label: neighbourhood + (city ? ", " + city : ""),
      kind: "area",
    });
  } else if (city) {
    options.push({
      id: "area",
      title: "This neighbourhood / area",
      detail: city,
      label: city,
      kind: "area",
    });
  }

  // Low-confidence named POI: still offer it, but after street/house
  if (landmark && landmark.name && !highConfidence) {
    const already = options.some(
      (o) =>
        o.kind === "landmark" &&
        o.label.toLowerCase() === landmark.name.toLowerCase()
    );
    if (!already) {
      options.push({
        id: "landmark",
        title: "Nearby landmark",
        detail:
          landmark.name +
          (landmark.typeLabel ? " (" + landmark.typeLabel + ")" : "") +
          (landmark.dist_m != null ? " ~" + landmark.dist_m + " m" : ""),
        label: landmark.name,
        kind: "landmark",
        entityHint: landmark.entityType || "",
        osmTags: landmark.osmTags || {},
        type: landmark.type || "",
        class: landmark.class || "",
      });
    }
  }

  if (!options.length && displayName) {
    options.push({
      id: "place",
      title: "This place",
      detail: displayName,
      label: displayName,
      kind: "place",
    });
  }
  if (!options.length) {
    options.push({
      id: "coords",
      title: "This location",
      detail: "Coordinates only (no address found)",
      label:
        "location near " +
        formatCoord(currentSelection.lat) +
        ", " +
        formatCoord(currentSelection.lng),
      kind: "coords",
    });
  }
  return options;
}

function renderFocusOptions(options) {
  els.focusOptions.innerHTML = "";
  options.forEach((opt, index) => {
    const label = document.createElement("label");
    label.className = "focus-option" + (index === 0 ? " selected" : "");
    label.setAttribute("for", "focus-" + opt.id);
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "story-focus";
    input.id = "focus-" + opt.id;
    input.value = opt.id;
    input.checked = index === 0;
    const text = document.createElement("div");
    const title = document.createElement("div");
    title.className = "focus-label";
    title.textContent = opt.title;
    const detail = document.createElement("div");
    detail.className = "focus-detail";
    detail.textContent = opt.detail;
    text.appendChild(title);
    text.appendChild(detail);
    label.appendChild(input);
    label.appendChild(text);
    els.focusOptions.appendChild(label);
    input.addEventListener("change", () => {
      selectFocus(opt);
      els.focusOptions.querySelectorAll(".focus-option").forEach((el) => {
        el.classList.toggle("selected", el === label);
      });
    });
  });
  if (options.length) selectFocus(options[0]);
}

function selectFocus(opt) {
  if (!currentSelection) return;
  currentSelection.focus = opt;
  els.focusConfirm.textContent = "Selected: " + opt.label;
  els.focusConfirm.classList.add("visible");
  if (opt.kind === "landmark" && opt.label) {
    els.placeName.textContent = opt.label;
    els.placeName.hidden = false;
  }
  clearStory();
  updateGenerateButton();
}

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

function isUsefulNearbyHit(item, name) {
  if (!name || name.length < 2) return false;
  const lower = name.toLowerCase();
  if (lower === "yes" || lower === "no" || lower === "unnamed") return false;
  const cls = String(item.class || "").toLowerCase();
  const typ = String(item.type || "").toLowerCase();
  if (!NEARBY_ALLOWED_CLASSES[cls]) return false;
  if (NEARBY_SKIP_TYPES[typ]) return false;
  return true;
}

async function fetchNearbyPlaces(lat, lng, areaHint, signal) {
  const d = NEARBY_DELTA_DEG;
  const viewbox =
    lng - d + "," + (lat + d) + "," + (lng + d) + "," + (lat - d);
  const q = areaHint && String(areaHint).trim()
    ? String(areaHint).trim() + " museum memorial monument church park"
    : "museum memorial monument church park";
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=12&bounded=1" +
    "&addressdetails=0&dedupe=1&namedetails=1" +
    "&viewbox=" +
    encodeURIComponent(viewbox) +
    "&q=" +
    encodeURIComponent(q);

  try {
    const res = await fetch(url, { headers: NOMINATIM_HEADERS, signal });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const seen = {};
    const places = [];
    data.forEach((item) => {
      let name =
        (item.namedetails && item.namedetails.name) ||
        item.name ||
        (item.display_name ? item.display_name.split(",")[0] : "") ||
        "";
      name = String(name).trim();
      if (!isUsefulNearbyHit(item, name)) return;
      const itemLat = parseFloat(item.lat);
      const itemLng = parseFloat(item.lon);
      if (!isFinite(itemLat) || !isFinite(itemLng)) return;
      const distM = Math.round(haversineMeters(lat, lng, itemLat, itemLng));
      if (distM > NEARBY_MAX_M) return;
      const key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      places.push({
        name,
        type: [item.class, item.type].filter(Boolean).join("/") || "",
        display_name: item.display_name || name,
        dist_m: distM,
        lat: itemLat,
        lng: itemLng,
      });
    });
    places.sort((a, b) => a.dist_m - b.dist_m);
    return places.slice(0, 8);
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    return [];
  }
}

async function reverseGeocode(lat, lng, fallbackLabel, preferredLandmark) {
  if (reverseAbort) reverseAbort.abort();
  reverseAbort = new AbortController();
  const signal = reverseAbort.signal;
  try {
    const reverseUrl =
      "https://nominatim.openstreetmap.org/reverse?lat=" +
      encodeURIComponent(lat) +
      "&lon=" +
      encodeURIComponent(lng) +
      "&format=json&addressdetails=1&extratags=1&namedetails=1&zoom=18";

    const reversePromise = fetch(reverseUrl, {
      headers: NOMINATIM_HEADERS,
      signal,
    }).then(async (res) => {
      if (!res.ok) throw new Error("Reverse geocode failed");
      return res.json();
    });

    const landmarksPromise = fetchNearbyLandmarks(lat, lng, signal).catch(
      (err) => {
        if (err && err.name === "AbortError") throw err;
        return [];
      }
    );

    const [data, nearbyLandmarks] = await Promise.all([
      reversePromise,
      landmarksPromise,
    ]);

    if (
      !currentSelection ||
      currentSelection.lat !== lat ||
      currentSelection.lng !== lng
    ) {
      return;
    }

    let address = data.address || {};
    let displayName = data.display_name || fallbackLabel || "";

    const fromReverse = landmarkFromNominatimHit(data, lat, lng);
    const preferred =
      preferredLandmark ||
      (currentSelection && currentSelection.preferredLandmark) ||
      null;
    const candidates = nearbyLandmarks.slice();
    if (fromReverse) candidates.push(fromReverse);
    const picked = pickPreferredLandmark(candidates, preferred);
    const landmark = picked.highConfidence
      ? picked.best
      : preferred && preferred.name
        ? preferred
        : picked.best;
    const preferredMatch =
      !!(
        preferred &&
        preferred.name &&
        landmark &&
        landmark.name &&
        landmark.name.toLowerCase() === preferred.name.toLowerCase()
      );
    const highConfidence = picked.highConfidence || preferredMatch;

    if (landmark && highConfidence) {
      address = mergeLandmarkIntoAddress(address, landmark);
      displayName = landmark.displayName || landmark.name || displayName;
      els.placeName.textContent = landmark.name;
      els.placeName.hidden = false;
    } else if (displayName) {
      els.placeName.textContent = displayName;
      els.placeName.hidden = false;
    }

    currentSelection.address = address;
    currentSelection.displayName = displayName;
    currentSelection.landmark = landmark || null;

    const options = buildFocusOptions(
      address,
      displayName,
      landmark,
      highConfidence
    );
    currentSelection.options = options;
    els.reverseStatus.textContent = "";
    renderFocusOptions(options);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    els.reverseStatus.textContent =
      "Could not look up address. You can still pick a focus from coordinates.";
    els.reverseStatus.classList.add("error");
    if (!currentSelection) return;
    const preferred =
      preferredLandmark || currentSelection.preferredLandmark || null;
    const options = buildFocusOptions(
      {},
      fallbackLabel || "",
      preferred,
      !!(preferred && preferred.name)
    );
    currentSelection.options = options;
    renderFocusOptions(options);
  }
}

function placeYouAreHere(lat, lng) {
  lastUserLat = lat;
  lastUserLng = lng;
  const icon = L.divIcon({
    className: "you-are-here-icon",
    html: '<div class="you-are-here-dot" title="You are here"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  if (youAreHereMarker) youAreHereMarker.setLatLng([lat, lng]);
  else {
    youAreHereMarker = L.marker([lat, lng], {
      icon,
      zIndexOffset: 1000,
      title: "You are here",
    }).addTo(map);
  }
  if (mobileMap && mobileMapReady) {
    mobileMap.placeYouAreHere(lat, lng);
  }
}

function requestLocation(fromButton) {
  if (!navigator.geolocation) {
    setGeoBanner(
      "Geolocation is not supported in this browser. Click the map or search instead.",
      "error"
    );
    return;
  }
  if (fromButton) {
    els.locateBtn.disabled = true;
    setGeoBanner("Finding your location...");
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      placeYouAreHere(lat, lng);
      if (mobileFit && mobileMap && mobileMapReady) {
        mobileMap.flyTo(lat, lng, 17);
      } else {
        map.flyTo([lat, lng], 16, { duration: 1.2 });
      }
      setGeoBanner(
        mobileFit
          ? "Centered on you. Tap a building or a nearby chip to start a tour."
          : "Map centered on your location. Blue marker = you are here.",
        "ok"
      );
      els.locateBtn.disabled = false;
      if (fromButton) showLocation(lat, lng);
      else if (mobileFit) refreshNearbyChips(lat, lng);
    },
    (err) => {
      els.locateBtn.disabled = false;
      let msg =
        "Location unavailable. You can still explore by clicking the map or searching.";
      if (err && err.code === 1) {
        msg =
          "Location permission denied. Click the map or search a place - the map still works.";
      } else if (err && err.code === 2) {
        msg =
          "Your location could not be determined. Click the map or search instead.";
      } else if (err && err.code === 3) {
        msg =
          'Location request timed out. Try "Use my location" again, or click/search.';
      }
      setGeoBanner(msg, "error");
    },
    { enableHighAccuracy: !!mobileFit, timeout: 12000, maximumAge: 60000 }
  );
}

async function generateStory(confirmedCandidate) {
  const key = getApiKey();
  if (!key) {
    openKeyModal(true);
    setGeoBanner("Add your OpenAI API key to generate stories.", "error");
    return;
  }
  if (!currentSelection || !currentSelection.focus) return;

  pipeline.setApiKey(key);
  pipeline.setModel(getStoryModel());

  stopSpeech();
  lastSpeakText = "";
  els.speechControls.classList.remove("visible");
  els.generateBtn.disabled = true;
  renderer.showLoading(
    confirmedCandidate
      ? "Confirmed - researching with source checks..."
      : "Identifying place and researching with source checks..."
  );

  const addr = currentSelection.address || {};
  const road =
    addr.road || addr.pedestrian || addr.footway || addr.path || "";
  const neighbourhood = addr.neighbourhood || "";
  const suburb = addr.suburb || "";
  const quarter = addr.quarter || "";
  const cityDistrict =
    addr.city_district || addr.district || addr.borough || "";
  const suburbOrHood =
    neighbourhood || suburb || quarter || cityDistrict || "";
  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.county ||
    "";

  if (nearbyAbort) nearbyAbort.abort();
  nearbyAbort = new AbortController();
  let nearbyPlaces = [];
  try {
    nearbyPlaces = await fetchNearbyPlaces(
      currentSelection.lat,
      currentSelection.lng,
      suburbOrHood || city || road,
      nearbyAbort.signal
    );
  } catch (nearbyErr) {
    if (nearbyErr && nearbyErr.name === "AbortError") {
      updateGenerateButton();
      return;
    }
    nearbyPlaces = [];
  }
  currentSelection.nearbyPlaces = nearbyPlaces;

  try {
    const result = await pipeline.run(currentSelection, {
      categories: getSelectedCategories(),
      kidsMode: isKidsMode(),
      confirmedCandidate: confirmedCandidate || pendingConfirm || null,
      skipCache: !!confirmedCandidate,
    });

    const rendered = renderer.render(result, {
      kidsMode: isKidsMode(),
      onConfirmCandidate: (c) => {
        pendingConfirm = c;
        generateStory(c);
      },
    });

    lastSpeakText = (rendered && rendered.speakText) || "";
    if (lastSpeakText) {
      els.speechControls.classList.add("visible");
      updateSpeechUi();
      setTimeout(() => {
        if (els.speechPlayBtn && !els.speechPlayBtn.disabled) {
          els.speechPlayBtn.focus();
        }
      }, 50);
    } else {
      updateSpeechUi();
    }
  } catch (err) {
    renderer.renderError(
      "error",
      (err && err.message) ||
        "Network error. Check your connection and OpenAI access."
    );
  } finally {
    updateGenerateButton();
  }
}

// -- Events --
map.on("click", (e) => {
  showLocation(e.latlng.lat, e.latlng.lng);
  setStatus("");
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q) return;
  els.btn.disabled = true;
  setStatus("Searching...");
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(q) +
      "&format=json&addressdetails=1&extratags=1&namedetails=1&limit=1";
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!res.ok) throw new Error("Geocoder request failed");
    const data = await res.json();
    if (!data || !data.length) {
      setStatus("No results found.", true);
      return;
    }
    const hit = data[0];
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    const preferredLandmark = isLandmarkClassType(hit.class, hit.type)
      ? landmarkFromNominatimHit(hit, lat, lng)
      : null;
    map.flyTo([lat, lng], 15, { duration: 1.2 });
    if (mobileMap && mobileMapReady) {
      mobileMap.flyTo(lat, lng, 16);
    }
    showLocation(lat, lng, hit.display_name, {
      preferredLandmark: preferredLandmark,
    });
    setStatus("");
  } catch (_) {
    setStatus("Search failed. Try again.", true);
  } finally {
    els.btn.disabled = false;
  }
});

els.locateBtn.addEventListener("click", () => requestLocation(true));
els.settingsBtn.addEventListener("click", () => openKeyModal(false));

if (els.mobileFitInput) {
  els.mobileFitInput.addEventListener("change", () => {
    setMobileFit(!!els.mobileFitInput.checked, true);
  });
}

if (els.compassBtn) {
  els.compassBtn.addEventListener("click", async () => {
    if (!mobileMap) return;
    els.compassBtn.disabled = true;
    const ok = await mobileMap.startCompass();
    els.compassBtn.disabled = false;
    if (ok) {
      setGeoBanner("Compass on - map bearing follows your device when allowed.", "ok");
    } else {
      setGeoBanner(
        "Compass permission denied or unavailable. You can still rotate the map by drag.",
        "error"
      );
    }
  });
}

els.saveKeyBtn.addEventListener("click", () => {
  const key = els.apiKeyInput.value.trim() || getApiKey();
  if (!key) {
    els.apiKeyInput.focus();
    return;
  }
  const chosenModel =
    els.modelEconomy && els.modelEconomy.checked
      ? MODEL_ECONOMY
      : MODEL_QUALITY;
  setStoryModel(chosenModel);
  setApiKey(key);
  closeKeyModal();
  setGeoBanner(
    "API key saved (" +
      (chosenModel === MODEL_ECONOMY ? "Economy" : "Quality") +
      " model). Key stays in this browser only.",
    "ok"
  );
});

els.clearKeyBtn.addEventListener("click", () => {
  setApiKey("");
  els.apiKeyInput.value = "";
  updateGenerateButton();
  setGeoBanner("API key cleared from this browser.", "ok");
});

els.closeKeyBtn.addEventListener("click", closeKeyModal);
els.keyModal.addEventListener("click", (e) => {
  if (e.target === els.keyModal) closeKeyModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.keyModal.classList.contains("open")) {
    closeKeyModal();
  }
});

els.generateBtn.addEventListener("click", () => {
  if (!getApiKey()) {
    openKeyModal(true);
    return;
  }
  pendingConfirm = null;
  generateStory();
});

els.speechPlayBtn.addEventListener("click", speakStory);
els.speechPauseBtn.addEventListener("click", togglePauseSpeech);
els.speechStopBtn.addEventListener("click", stopSpeech);

if (els.kidsMode) {
  els.kidsMode.addEventListener("change", () => {
    // Re-render speak text preference is applied on next generate
  });
}

if (speechSupported()) {
  window.speechSynthesis.addEventListener("voiceschanged", refreshPreferredVoice);
  refreshPreferredVoice();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (
      speechSupported() &&
      !window.speechSynthesis.speaking &&
      !window.speechSynthesis.paused &&
      speechState !== "idle"
    ) {
      speechState = "idle";
      updateSpeechUi();
    }
  });
}

updateSpeechUi();
updateKeyUi();
syncModelRadios();

if (!getApiKey()) {
  setTimeout(() => openKeyModal(true), 400);
}

initMobileFit();
requestLocation(false);
setTimeout(() => {
  map.invalidateSize();
  if (mobileMap) mobileMap.resize();
}, 0);
window.addEventListener("resize", () => {
  map.invalidateSize();
  if (mobileMap) mobileMap.resize();
});

// ---- Mobile fit + MapLibre ----

function readMobileFitPref() {
  try {
    const stored = localStorage.getItem(MOBILE_FIT_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function writeMobileFitPref(on) {
  try {
    localStorage.setItem(MOBILE_FIT_STORAGE_KEY, on ? "1" : "0");
  } catch (_) {
    /* ignore */
  }
}

function isNarrowViewport() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 768px)").matches
  );
}

function initMobileFit() {
  const pref = readMobileFitPref();
  const enable = pref === null ? isNarrowViewport() : pref;
  setMobileFit(enable, pref !== null);
  if (pref === null && enable) {
    // Persist auto-enable so layout stays consistent across reloads on phone
    writeMobileFitPref(true);
  }
}

function setMobileFit(on, persist) {
  mobileFit = !!on;
  if (persist) writeMobileFitPref(mobileFit);
  document.body.classList.toggle("mobile-fit", mobileFit);
  if (els.mobileFitInput) els.mobileFitInput.checked = mobileFit;
  if (els.mobileToggle) {
    els.mobileToggle.classList.toggle("on", mobileFit);
  }
  if (els.compassBtn) {
    els.compassBtn.hidden = !mobileFit;
  }

  if (mobileFit) {
    ensureMobileMap();
    if (els.nearbyChips) {
      els.nearbyChips.hidden = false;
      els.nearbyChips.classList.add("visible");
    }
    const chipLat =
      lastUserLat != null
        ? lastUserLat
        : currentSelection
          ? currentSelection.lat
          : null;
    const chipLng =
      lastUserLng != null
        ? lastUserLng
        : currentSelection
          ? currentSelection.lng
          : null;
    if (chipLat != null && chipLng != null) {
      refreshNearbyChips(chipLat, chipLng);
    }
    setTimeout(() => {
      map.invalidateSize();
      if (mobileMap) mobileMap.resize();
    }, 50);
  } else {
    teardownMobileMapUi();
    setTimeout(() => map.invalidateSize(), 50);
  }
}

function teardownMobileMapUi() {
  if (els.mapStack) els.mapStack.classList.remove("maplibre-active");
  if (els.mapGl) els.mapGl.hidden = true;
  if (els.nearbyChips) {
    els.nearbyChips.classList.remove("visible");
    els.nearbyChips.hidden = true;
  }
  if (mobileMap) {
    mobileMap.stopCompass();
  }
}

async function ensureMobileMap() {
  if (mobileMapFailed) {
    // Keep Leaflet 2D under mobile layout
    teardownMobileMapUi();
    if (els.nearbyChips) {
      els.nearbyChips.hidden = false;
      els.nearbyChips.classList.add("visible");
    }
    return;
  }
  if (mobileMap) {
    if (els.mapGl) els.mapGl.hidden = false;
    if (els.mapStack) els.mapStack.classList.add("maplibre-active");
    setTimeout(() => mobileMap.resize(), 40);
    return;
  }
  if (!els.mapGl) return;

  try {
    await loadMapLibreFromCdn();
  } catch (err) {
    mobileMapFailed = true;
    console.warn("[MobileFit] MapLibre CDN load failed:", err);
    setGeoBanner(
      "3D map unavailable - using flat map with mobile layout. Nearby chips still work.",
      "error"
    );
    teardownMobileMapUi();
    if (els.nearbyChips) {
      els.nearbyChips.hidden = false;
      els.nearbyChips.classList.add("visible");
    }
    return;
  }

  if (!mobileFit) return;

  els.mapGl.hidden = false;
  mobileMap = createMobileMap({
    container: els.mapGl,
    onSelect: (lat, lng, meta) => {
      const preferred =
        meta && meta.name
          ? {
              name: meta.name,
              lat: lat,
              lng: lng,
              typeLabel: meta.isBuilding ? "building" : "place",
              dist_m: 0,
              score: 80,
            }
          : null;
      showLocation(lat, lng, meta && meta.name ? meta.name : "", {
        preferredLandmark: preferred,
      });
      setStatus("");
    },
    onReady: (info) => {
      mobileMapReady = true;
      if (els.mapStack) els.mapStack.classList.add("maplibre-active");
      if (lastUserLat != null && lastUserLng != null) {
        mobileMap.placeYouAreHere(lastUserLat, lastUserLng);
        mobileMap.flyTo(lastUserLat, lastUserLng, 17);
      } else if (currentSelection) {
        mobileMap.flyTo(currentSelection.lat, currentSelection.lng, 16.5);
        mobileMap.placeSelection(currentSelection.lat, currentSelection.lng);
      }
      const tip = info && info.has3d
        ? "Mobile map ready with 3D building extrusions (OpenFreeMap). Tap a building or a nearby chip."
        : "Mobile pitched map ready. 3D building data limited here - use nearby chips to pick places next to you.";
      setGeoBanner(tip, "ok");
      setTimeout(() => mobileMap.resize(), 60);
    },
    onFail: (err) => {
      mobileMapFailed = true;
      mobileMap = null;
      mobileMapReady = false;
      console.warn("[MobileFit] MapLibre init failed:", err);
      setGeoBanner(
        "3D map failed to start - using flat map with mobile layout.",
        "error"
      );
      teardownMobileMapUi();
      if (els.nearbyChips) {
        els.nearbyChips.hidden = false;
        els.nearbyChips.classList.add("visible");
      }
    },
  });

  if (!mobileMap) {
    mobileMapFailed = true;
    teardownMobileMapUi();
  }
}

function clearNearbyChips() {
  if (!els.nearbyChips) return;
  const label = els.nearbyChips.querySelector(".nearby-chips-label");
  els.nearbyChips.innerHTML = "";
  if (label) {
    els.nearbyChips.appendChild(label);
  } else {
    const div = document.createElement("div");
    div.className = "nearby-chips-label";
    div.textContent = "Nearby (tap to select)";
    els.nearbyChips.appendChild(div);
  }
}

async function refreshNearbyChips(lat, lng) {
  if (!els.nearbyChips || !mobileFit) return;
  if (chipsAbort) chipsAbort.abort();
  chipsAbort = new AbortController();
  const signal = chipsAbort.signal;
  clearNearbyChips();
  const loading = document.createElement("button");
  loading.type = "button";
  loading.className = "nearby-chip";
  loading.disabled = true;
  loading.textContent = "Finding nearby...";
  els.nearbyChips.appendChild(loading);

  try {
    const list = await fetchNearbyLandmarks(lat, lng, signal);
    if (signal.aborted) return;
    clearNearbyChips();
    const near = (list || [])
      .filter(function (p) {
        return p && p.name && (p.dist_m == null || p.dist_m <= MOBILE_NEARBY_CHIP_M);
      })
      .slice(0, 10);

    if (!near.length) {
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "nearby-chip";
      empty.disabled = true;
      empty.textContent = "No named landmarks within ~150 m";
      els.nearbyChips.appendChild(empty);
      return;
    }

    near.forEach(function (place) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nearby-chip";
      const title = document.createTextNode(place.name);
      btn.appendChild(title);
      const meta = document.createElement("span");
      meta.className = "chip-meta";
      const bits = [];
      if (place.typeLabel) bits.push(place.typeLabel);
      if (place.dist_m != null) bits.push("~" + place.dist_m + " m");
      meta.textContent = bits.join(" - ") || "landmark";
      btn.appendChild(meta);
      btn.addEventListener("click", function () {
        const plat = place.lat != null ? place.lat : lat;
        const plng = place.lng != null ? place.lng : lng;
        if (mobileMap && mobileMapReady) {
          mobileMap.flyTo(plat, plng, 17.5);
        } else {
          map.flyTo([plat, plng], 17, { duration: 0.8 });
        }
        showLocation(plat, plng, place.name, { preferredLandmark: place });
        setStatus("");
      });
      els.nearbyChips.appendChild(btn);
    });
  } catch (err) {
    if (err && err.name === "AbortError") return;
    clearNearbyChips();
    const fail = document.createElement("button");
    fail.type = "button";
    fail.className = "nearby-chip";
    fail.disabled = true;
    fail.textContent = "Nearby lookup failed";
    els.nearbyChips.appendChild(fail);
  }
}