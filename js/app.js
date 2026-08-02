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
  TTS_VOICE_STORAGE_KEY,
  MOBILE_FIT_STORAGE_KEY,
  MOBILE_NEARBY_CHIP_M,
  MODEL_QUALITY,
  MODEL_ECONOMY,
  DEFAULT_MODEL,
  NEARBY_MAX_M,
  NEARBY_ALLOWED_CLASSES,
  NEARBY_SKIP_TYPES,
  STORY_CATEGORIES,
  LANDMARK_UI_SOFT_WAIT_MS,
  OPENAI_TTS_MODEL_PREFERRED,
  OPENAI_TTS_MODEL_FALLBACK,
  OPENAI_TTS_VOICES,
  OPENAI_TTS_DEFAULT_VOICE,
  OPENAI_TTS_SPEED,
  OPENAI_TTS_MAX_CHARS,
  OPENAI_TTS_INSTRUCTIONS,
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
  searchPlaces,
  reverseGeocodePlace,
  searchNearbyText,
  formatGeocoderError,
} from "./services/Geocoder.js";
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
/** True after the user manually changes the story-focus radio. */
let focusTouchedByUser = false;
let speechState = "idle";
/** "openai" | "webspeech" | null */
let speechEngine = null;
let preferredVoice = null;
let lastSpeakText = "";
let pendingConfirm = null;
let speechToken = 0;
let speechTimer = null;
let speechQueue = [];
let speechIndex = 0;
let speechPausedBetween = false;
let speechLoading = false;
let openaiAudio = null;
let openaiBlobUrl = null;
/** Cached working TTS model for this session (preferred or fallback). */
let openaiTtsModelResolved = null;
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
  speechNote: document.getElementById("speech-note"),
  appVersion: document.getElementById("app-version"),
  panelVersion: document.getElementById("panel-version"),
  categoryOptions: document.getElementById("category-options"),
  kidsMode: document.getElementById("kids-mode"),
  citationsBlock: document.getElementById("citations-block"),
  confirmBlock: document.getElementById("confirm-block"),
  claimsMeta: document.getElementById("claims-meta"),
  ttsVoiceNova: document.getElementById("tts-voice-nova"),
  ttsVoiceShimmer: document.getElementById("tts-voice-shimmer"),
  ttsVoiceCoral: document.getElementById("tts-voice-coral"),
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

function audioPlaybackSupported() {
  return typeof Audio !== "undefined";
}

function narrationAvailable() {
  return speechSupported() || audioPlaybackSupported();
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
/** Museum audio-guide pacing: calm, slightly slow, steady (Web Speech fallback). */
const SPEECH_RATE = 0.88;
const SPEECH_PITCH = 0.95;
const SPEECH_VOLUME = 1;
const SPEECH_GAP_MS = 340;
/** Slightly longer gap between OpenAI TTS chunks for museum pacing. */
const OPENAI_TTS_GAP_MS = 420;

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

/**
 * Split narration into paragraph/sentence chunks.
 * @param {string} text
 * @param {number} [maxLen=280] - soft max chars per chunk (OpenAI TTS uses ~3600).
 */
function splitSpokenChunks(text, maxLen) {
  const limit = typeof maxLen === "number" && maxLen > 0 ? maxLen : 280;
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map(function (p) {
      return p.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
  const chunks = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p];
    if (para.length <= limit) {
      chunks.push(para);
      continue;
    }
    const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [para];
    let buf = "";
    for (let s = 0; s < sentences.length; s++) {
      const piece = sentences[s].trim();
      if (!piece) continue;
      if (buf && (buf + " " + piece).length > limit) {
        chunks.push(buf);
        buf = piece;
        // Hard-split oversized sentences under the OpenAI char cap.
        while (buf.length > limit) {
          let cut = buf.lastIndexOf(" ", limit);
          if (cut < limit * 0.5) cut = limit;
          chunks.push(buf.slice(0, cut).trim());
          buf = buf.slice(cut).trim();
        }
      } else {
        buf = buf ? buf + " " + piece : piece;
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks.length ? chunks : [String(text).trim()].filter(Boolean);
}

function idleSpeechHint() {
  return "Tap Listen for a guided narration";
}

function updateSpeechNote() {
  if (!els.speechNote) return;
  if (getApiKey()) {
    els.speechNote.hidden = false;
    els.speechNote.textContent =
      "Narration uses OpenAI voice when your API key is set";
  } else {
    els.speechNote.hidden = false;
    els.speechNote.textContent =
      "Add an API key for natural OpenAI narration (otherwise browser voice)";
  }
}

function updateSpeechUi() {
  const hasStory = !!(lastSpeakText || "").trim();
  const supported = narrationAvailable();
  els.speechControls.classList.toggle(
    "visible",
    hasStory || speechState !== "idle" || speechLoading
  );
  updateSpeechNote();

  if (!supported) {
    els.speechPlayBtn.disabled = true;
    els.speechPauseBtn.disabled = true;
    els.speechStopBtn.disabled = true;
    els.speechHint.textContent =
      "Narration is not supported in this browser.";
    return;
  }

  if (speechLoading) {
    els.speechPlayBtn.disabled = true;
    els.speechPauseBtn.disabled = true;
    els.speechStopBtn.disabled = false;
    els.speechPauseBtn.textContent = "Pause";
    els.speechHint.textContent = "Preparing museum-style narration...";
    els.speechHint.classList.remove("pulse");
    return;
  }

  els.speechPlayBtn.disabled = !hasStory || speechState === "speaking";
  els.speechStopBtn.disabled = speechState === "idle";
  const canPause =
    speechEngine === "openai" ||
    (speechSupported() &&
      typeof window.speechSynthesis.pause === "function" &&
      typeof window.speechSynthesis.resume === "function");

  if (speechState === "speaking") {
    els.speechPauseBtn.disabled = !canPause;
    els.speechPauseBtn.textContent = "Pause";
    els.speechHint.textContent =
      speechEngine === "openai"
        ? "Listening to OpenAI guide voice..."
        : "Reading the story aloud...";
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
      els.speechHint.textContent = idleSpeechHint();
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

function revokeOpenAiBlob() {
  if (openaiBlobUrl) {
    try {
      URL.revokeObjectURL(openaiBlobUrl);
    } catch (_) {
      /* ignore */
    }
    openaiBlobUrl = null;
  }
}

function clearOpenAiAudio() {
  if (openaiAudio) {
    try {
      openaiAudio.onended = null;
      openaiAudio.onerror = null;
      openaiAudio.onplay = null;
      openaiAudio.pause();
      openaiAudio.removeAttribute("src");
      openaiAudio.load();
    } catch (_) {
      /* ignore */
    }
    openaiAudio = null;
  }
  revokeOpenAiBlob();
}

function stopSpeech() {
  speechToken += 1;
  speechPausedBetween = false;
  speechLoading = false;
  speechQueue = [];
  speechIndex = 0;
  clearSpeechTimer();
  clearOpenAiAudio();
  if (speechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {
      /* ignore */
    }
  }
  speechEngine = null;
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

function speakNextWebChunk(token) {
  if (token !== speechToken || speechPausedBetween) return;
  if (speechIndex >= speechQueue.length) {
    speechState = "idle";
    speechEngine = null;
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
      speechEngine = null;
      updateSpeechUi();
      return;
    }
    speechTimer = setTimeout(() => {
      speechTimer = null;
      if (token !== speechToken || speechPausedBetween) return;
      speakNextWebChunk(token);
    }, SPEECH_GAP_MS);
  };
  utter.onerror = () => {
    if (token !== speechToken) return;
    speechState = "idle";
    speechEngine = null;
    updateSpeechUi();
  };

  try {
    window.speechSynthesis.speak(utter);
  } catch (_) {
    speechState = "idle";
    speechEngine = null;
    els.speechHint.textContent = "Could not start narration. Try again.";
    updateSpeechUi();
  }
}

function startWebSpeech(spoken, token) {
  if (!speechSupported()) {
    speechLoading = false;
    speechState = "idle";
    speechEngine = null;
    els.speechHint.textContent =
      "Narration is not supported in this browser.";
    updateSpeechUi();
    return;
  }
  refreshPreferredVoice();
  speechEngine = "webspeech";
  speechQueue = splitSpokenChunks(spoken, 280);
  speechIndex = 0;
  speechPausedBetween = false;
  speechLoading = false;
  speechState = "speaking";
  updateSpeechUi();
  setTimeout(() => {
    if (token !== speechToken) return;
    try {
      speakNextWebChunk(token);
    } catch (_) {
      speechState = "idle";
      speechEngine = null;
      els.speechHint.textContent = "Could not start narration. Try again.";
      updateSpeechUi();
    }
  }, 40);
}

async function fetchOpenAiSpeechBlob(text) {
  const voice = getTtsVoice();
  const models = openaiTtsModelResolved
    ? [openaiTtsModelResolved]
    : [OPENAI_TTS_MODEL_PREFERRED, OPENAI_TTS_MODEL_FALLBACK];
  let last = { ok: false, error: "TTS failed" };
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const result = await pipeline.openAi.createSpeech({
      input: text,
      voice: voice,
      speed: OPENAI_TTS_SPEED,
      model: model,
      instructions:
        model === OPENAI_TTS_MODEL_PREFERRED ? OPENAI_TTS_INSTRUCTIONS : null,
    });
    if (result.ok) {
      openaiTtsModelResolved = model;
      return result;
    }
    last = result;
    if (result.status === 401 || result.status === 403) break;
    // Model unavailable / not found → try fallback; other errors stop retries.
    const msg = (result.error || "").toLowerCase();
    const tryNext =
      result.status === 404 ||
      /model|not found|does not exist|invalid/i.test(msg);
    if (!tryNext) break;
  }
  return last;
}

function playOpenAiBlob(blob, token) {
  return new Promise((resolve) => {
    if (token !== speechToken) {
      resolve("stopped");
      return;
    }
    clearOpenAiAudio();
    const url = URL.createObjectURL(blob);
    openaiBlobUrl = url;
    const audio = new Audio(url);
    openaiAudio = audio;
    audio.onplay = () => {
      if (token !== speechToken) return;
      speechLoading = false;
      speechState = "speaking";
      updateSpeechUi();
    };
    audio.onended = () => {
      resolve(token === speechToken ? "ended" : "stopped");
    };
    audio.onerror = () => {
      resolve(token === speechToken ? "error" : "stopped");
    };
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {
        resolve(token === speechToken ? "error" : "stopped");
      });
    }
  });
}

async function speakNextOpenAiChunk(token) {
  if (token !== speechToken || speechPausedBetween) return;
  if (speechIndex >= speechQueue.length) {
    speechLoading = false;
    speechState = "idle";
    speechEngine = null;
    clearOpenAiAudio();
    updateSpeechUi();
    return;
  }

  speechLoading = speechIndex === 0 || !openaiAudio;
  if (speechLoading) updateSpeechUi();

  const chunk = speechQueue[speechIndex];
  const result = await fetchOpenAiSpeechBlob(chunk);
  if (token !== speechToken || speechPausedBetween) return;

  if (!result.ok) {
    // First chunk failure → fall back to Web Speech for the full script.
    if (speechIndex === 0) {
      const full = speechQueue.join("\n\n");
      clearOpenAiAudio();
      speechEngine = null;
      startWebSpeech(full, token);
      return;
    }
    // Mid-tour: try Web Speech for remaining chunks.
    const remaining = speechQueue.slice(speechIndex).join("\n\n");
    clearOpenAiAudio();
    startWebSpeech(remaining, token);
    return;
  }

  speechLoading = false;
  if (token !== speechToken) return;
  if (speechPausedBetween) {
    speechState = "paused";
    updateSpeechUi();
    return;
  }
  const outcome = await playOpenAiBlob(result.blob, token);
  if (token !== speechToken) return;
  if (speechPausedBetween) {
    speechState = "paused";
    updateSpeechUi();
    return;
  }

  if (outcome === "error") {
    if (speechIndex === 0) {
      startWebSpeech(speechQueue.join("\n\n"), token);
      return;
    }
    startWebSpeech(speechQueue.slice(speechIndex).join("\n\n"), token);
    return;
  }
  if (outcome !== "ended") return;

  speechIndex += 1;
  if (speechIndex >= speechQueue.length) {
    speechState = "idle";
    speechEngine = null;
    clearOpenAiAudio();
    updateSpeechUi();
    return;
  }

  speechTimer = setTimeout(() => {
    speechTimer = null;
    if (token !== speechToken || speechPausedBetween) return;
    speakNextOpenAiChunk(token);
  }, OPENAI_TTS_GAP_MS);
}

async function startOpenAiSpeech(spoken, token) {
  speechEngine = "openai";
  speechQueue = splitSpokenChunks(spoken, OPENAI_TTS_MAX_CHARS);
  speechIndex = 0;
  speechPausedBetween = false;
  speechLoading = true;
  speechState = "speaking";
  updateSpeechUi();
  try {
    await speakNextOpenAiChunk(token);
  } catch (_) {
    if (token !== speechToken) return;
    startWebSpeech(spoken, token);
  }
}

function speakStory() {
  if (!narrationAvailable()) {
    updateSpeechUi();
    return;
  }
  const spoken = cleanSpokenText(lastSpeakText);
  if (!spoken) return;

  stopSpeech();
  const token = ++speechToken;
  const key = getApiKey();

  if (key && audioPlaybackSupported()) {
    startOpenAiSpeech(spoken, token);
    return;
  }
  startWebSpeech(spoken, token);
}

function togglePauseSpeech() {
  if (speechEngine === "openai") {
    if (speechState === "speaking") {
      if (speechTimer) {
        clearSpeechTimer();
        speechPausedBetween = true;
        speechState = "paused";
      } else if (openaiAudio) {
        try {
          openaiAudio.pause();
          speechState = "paused";
        } catch (_) {
          stopSpeech();
          return;
        }
      } else {
        speechPausedBetween = true;
        speechState = "paused";
      }
    } else if (speechState === "paused") {
      speechPausedBetween = false;
      if (openaiAudio && openaiAudio.paused && !openaiAudio.ended) {
        const playPromise = openaiAudio.play();
        speechState = "speaking";
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => stopSpeech());
        }
      } else {
        speechState = "speaking";
        speakNextOpenAiChunk(speechToken);
      }
    }
    updateSpeechUi();
    return;
  }

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
      speakNextWebChunk(speechToken);
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

function getTtsVoice() {
  try {
    const stored = (localStorage.getItem(TTS_VOICE_STORAGE_KEY) || "")
      .trim()
      .toLowerCase();
    if (OPENAI_TTS_VOICES.indexOf(stored) !== -1) return stored;
  } catch (_) {
    /* ignore */
  }
  return OPENAI_TTS_DEFAULT_VOICE;
}

function setTtsVoice(voice) {
  const next =
    OPENAI_TTS_VOICES.indexOf(voice) !== -1 ? voice : OPENAI_TTS_DEFAULT_VOICE;
  try {
    localStorage.setItem(TTS_VOICE_STORAGE_KEY, next);
  } catch (_) {
    /* ignore */
  }
  syncTtsVoiceRadios();
}

function syncTtsVoiceRadios() {
  const voice = getTtsVoice();
  if (els.ttsVoiceNova) els.ttsVoiceNova.checked = voice === "nova";
  if (els.ttsVoiceShimmer) els.ttsVoiceShimmer.checked = voice === "shimmer";
  if (els.ttsVoiceCoral) els.ttsVoiceCoral.checked = voice === "coral";
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
  updateSpeechNote();
}

function openKeyModal(force) {
  els.apiKeyInput.value = getApiKey();
  syncModelRadios();
  syncTtsVoiceRadios();
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
  // Desktop only: Google Maps embed + external map links (hidden in mobile-fit)
  if (!mobileFit) {
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
  } else if (els.embed) {
    els.embed.removeAttribute("src");
  }

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
  focusTouchedByUser = false;

  els.focusOptions.innerHTML = "";
  els.focusConfirm.classList.remove("visible");
  els.focusConfirm.textContent = "";
  els.reverseStatus.textContent = "Looking up place...";
  els.reverseStatus.classList.remove("error");
  clearStory();
  updateGenerateButton();

  // Prefer known landmark (search/chip) immediately so focus UI is usable
  // while reverse geocode + Overpass enrichment continue.
  if (opts.preferredLandmark && opts.preferredLandmark.name) {
    const earlyName =
      opts.preferredLandmark.name || label || "";
    if (earlyName) {
      els.placeName.textContent = earlyName;
      els.placeName.hidden = false;
    }
    const earlyOptions = buildFocusOptions(
      {},
      earlyName,
      opts.preferredLandmark,
      true
    );
    currentSelection.options = earlyOptions;
    currentSelection.landmark = opts.preferredLandmark;
    els.reverseStatus.textContent = "Looking up address...";
    renderFocusOptions(earlyOptions);
  }

  reverseGeocode(latNum, lngNum, label, opts.preferredLandmark || null);

  if (mobileFit) {
    refreshNearbyChips(latNum, lngNum);
    scrollStoryGeneratorIntoView();
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

function renderFocusOptions(options, preferId) {
  els.focusOptions.innerHTML = "";
  let selectedIndex = 0;
  if (preferId) {
    const idx = options.findIndex((o) => o.id === preferId);
    if (idx >= 0) selectedIndex = idx;
  }
  options.forEach((opt, index) => {
    const label = document.createElement("label");
    label.className =
      "focus-option" + (index === selectedIndex ? " selected" : "");
    label.setAttribute("for", "focus-" + opt.id);
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "story-focus";
    input.id = "focus-" + opt.id;
    input.value = opt.id;
    input.checked = index === selectedIndex;
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
      focusTouchedByUser = true;
      selectFocus(opt);
      els.focusOptions.querySelectorAll(".focus-option").forEach((el) => {
        el.classList.toggle("selected", el === label);
      });
    });
  });
  if (options.length) selectFocus(options[selectedIndex]);
  if (mobileFit) scrollStoryGeneratorIntoView();
}

function scrollStoryGeneratorIntoView() {
  if (!mobileFit) return;
  const target =
    document.getElementById("story-generator") || els.focusOptions;
  if (!target) return;
  // Defer so panel layout settles after content becomes active
  requestAnimationFrame(function () {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
  const q = areaHint && String(areaHint).trim()
    ? String(areaHint).trim() + " museum memorial monument church park"
    : "museum memorial monument church park";

  try {
    const data = await searchNearbyText(q, lat, lng, { limit: 12, signal });
    if (!Array.isArray(data) || !data.length) return [];
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

function selectionStillCurrent(lat, lng) {
  return (
    !!currentSelection &&
    currentSelection.lat === lat &&
    currentSelection.lng === lng
  );
}

function softWait(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      resolve("aborted");
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Apply reverse + landmark results to the selection panel.
 * Safe to call multiple times as enrichment arrives.
 */
function applyPlaceLookupResult(lat, lng, data, nearbyLandmarks, fallbackLabel, preferredLandmark) {
  if (!selectionStillCurrent(lat, lng)) return;

  let address = (data && data.address) || {};
  let displayName =
    (data && data.display_name) || fallbackLabel || "";

  const fromReverse = data ? landmarkFromNominatimHit(data, lat, lng) : null;
  const preferred =
    preferredLandmark ||
    (currentSelection && currentSelection.preferredLandmark) ||
    null;
  const candidates = Array.isArray(nearbyLandmarks)
    ? nearbyLandmarks.slice()
    : [];
  if (fromReverse) candidates.push(fromReverse);
  const picked = pickPreferredLandmark(candidates, preferred);
  const landmark = picked.highConfidence
    ? picked.best
    : preferred && preferred.name
      ? preferred
      : picked.best;
  const preferredMatch = !!(
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
  els.reverseStatus.classList.remove("error");
  const keepId =
    focusTouchedByUser && currentSelection.focus
      ? currentSelection.focus.id
      : null;
  renderFocusOptions(options, keepId);
}

async function reverseGeocode(lat, lng, fallbackLabel, preferredLandmark) {
  if (reverseAbort) reverseAbort.abort();
  reverseAbort = new AbortController();
  const signal = reverseAbort.signal;
  let reverseData = null;
  let landmarksDone = false;
  let nearbyLandmarks = [];

  const reversePromise = reverseGeocodePlace(lat, lng, { signal });
  const landmarksPromise = fetchNearbyLandmarks(lat, lng, signal)
    .then((list) => {
      nearbyLandmarks = Array.isArray(list) ? list : [];
      landmarksDone = true;
      return nearbyLandmarks;
    })
    .catch((err) => {
      if (err && err.name === "AbortError") throw err;
      nearbyLandmarks = [];
      landmarksDone = true;
      return [];
    });

  // When landmarks arrive after provisional UI, enrich without blocking.
  landmarksPromise
    .then(() => {
      if (!selectionStillCurrent(lat, lng) || signal.aborted) return;
      if (reverseData) {
        applyPlaceLookupResult(
          lat,
          lng,
          reverseData,
          nearbyLandmarks,
          fallbackLabel,
          preferredLandmark
        );
      }
    })
    .catch(() => undefined);

  try {
    reverseData = await reversePromise;
    if (!selectionStillCurrent(lat, lng) || signal.aborted) return;

    // Brief soft wait so a fast Overpass hit lands in the first paint.
    if (!landmarksDone) {
      await Promise.race([
        landmarksPromise.catch(() => undefined),
        softWait(LANDMARK_UI_SOFT_WAIT_MS, signal),
      ]);
    }
    if (!selectionStillCurrent(lat, lng) || signal.aborted) return;

    applyPlaceLookupResult(
      lat,
      lng,
      reverseData,
      nearbyLandmarks,
      fallbackLabel,
      preferredLandmark
    );

    if (!landmarksDone) {
      els.reverseStatus.textContent = "Finding nearby landmarks...";
      els.reverseStatus.classList.remove("error");
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    const detail = formatGeocoderError(
      err,
      "Could not look up address. You can still pick a focus from coordinates."
    );
    els.reverseStatus.textContent = detail;
    els.reverseStatus.classList.add("error");
    if (!currentSelection) return;
    const preferred =
      preferredLandmark || currentSelection.preferredLandmark || null;
    // Still try landmarks if reverse failed — do not block forever.
    if (!landmarksDone) {
      try {
        await Promise.race([
          landmarksPromise.catch(() => undefined),
          softWait(LANDMARK_UI_SOFT_WAIT_MS, signal),
        ]);
      } catch (_) {
        /* ignore */
      }
    }
    if (!selectionStillCurrent(lat, lng)) return;
    applyPlaceLookupResult(
      lat,
      lng,
      null,
      nearbyLandmarks,
      fallbackLabel,
      preferred
    );
    if (detail) {
      els.reverseStatus.textContent = detail;
      els.reverseStatus.classList.add("error");
    }
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
    const data = await searchPlaces(q, { limit: 1 });
    if (!data || !data.length) {
      setStatus("No results found.", true);
      return;
    }
    const hit = data[0];
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (!isFinite(lat) || !isFinite(lng)) {
      setStatus("Search returned an invalid location. Try a different query.", true);
      return;
    }
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
  } catch (err) {
    setStatus(
      formatGeocoderError(err, "Search failed. Try again in a moment."),
      true
    );
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
  let chosenVoice = OPENAI_TTS_DEFAULT_VOICE;
  if (els.ttsVoiceShimmer && els.ttsVoiceShimmer.checked) chosenVoice = "shimmer";
  else if (els.ttsVoiceCoral && els.ttsVoiceCoral.checked) chosenVoice = "coral";
  else if (els.ttsVoiceNova && els.ttsVoiceNova.checked) chosenVoice = "nova";
  setTtsVoice(chosenVoice);
  setStoryModel(chosenModel);
  setApiKey(key);
  closeKeyModal();
  setGeoBanner(
    "API key saved (" +
      (chosenModel === MODEL_ECONOMY ? "Economy" : "Quality") +
      ", voice " +
      chosenVoice +
      "). Key stays in this browser only.",
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
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (speechEngine === "openai") return;
  if (
    speechSupported() &&
    !window.speechSynthesis.speaking &&
    !window.speechSynthesis.paused &&
    speechState !== "idle" &&
    !speechLoading
  ) {
    speechState = "idle";
    speechEngine = null;
    updateSpeechUi();
  }
});

updateSpeechUi();
updateKeyUi();
syncModelRadios();
syncTtsVoiceRadios();

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
    if (els.embed) els.embed.removeAttribute("src");
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
    if (currentSelection && els.embed) {
      const latNum = currentSelection.lat;
      const lngNum = currentSelection.lng;
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
    }
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