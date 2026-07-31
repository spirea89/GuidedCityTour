/**
 * GuidedCityTour app shell — map, geolocation, OSM, TTS, API key modal.
 * Stories go through TourPipeline (identify → research → verify → narrate).
 */
import {
  APP_VERSION,
  APP_VERSION_DATE,
  DEFAULT_MAP,
  STORAGE_KEY,
  MODEL_STORAGE_KEY,
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
let speechState = "idle";
let preferredVoice = null;
let lastSpeakText = "";
let pendingConfirm = null;

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
    "GuidedCityTour " + APP_VERSION + " · " + APP_VERSION_DATE;
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

function cleanSpokenText(raw) {
  if (!raw) return "";
  let text = String(raw);
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^[-*•]\s+/gm, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function pickSpeechLang() {
  return (navigator.language || "en-US").slice(0, 2);
}

function refreshPreferredVoice() {
  if (!speechSupported()) return;
  const voices = window.speechSynthesis.getVoices() || [];
  const want = pickSpeechLang();
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    const lang = (v.lang || "").toLowerCase();
    let score = 0;
    if (lang.startsWith(want)) score += 2;
    if (v.localService) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = voices[i];
    }
  }
  preferredVoice = bestScore > 0 ? best : voices[0] || null;
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
    els.speechHint.textContent = "Reading the story aloud…";
    els.speechHint.classList.remove("pulse");
  } else if (speechState === "paused") {
    els.speechPlayBtn.disabled = true;
    els.speechPauseBtn.disabled = !canPause;
    els.speechPauseBtn.textContent = "Resume";
    els.speechHint.textContent = "Paused — resume or stop narration.";
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

function stopSpeech() {
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

function speakStory() {
  if (!speechSupported()) {
    updateSpeechUi();
    return;
  }
  const spoken = cleanSpokenText(lastSpeakText);
  if (!spoken) return;
  stopSpeech();
  refreshPreferredVoice();
  const utter = new SpeechSynthesisUtterance(spoken);
  if (preferredVoice) {
    utter.voice = preferredVoice;
    utter.lang = preferredVoice.lang || pickSpeechLang();
  } else {
    utter.lang = pickSpeechLang();
  }
  utter.rate = 1;
  utter.onstart = () => {
    speechState = "speaking";
    updateSpeechUi();
  };
  utter.onend = () => {
    speechState = "idle";
    updateSpeechUi();
  };
  utter.onerror = () => {
    speechState = "idle";
    updateSpeechUi();
  };
  setTimeout(() => {
    try {
      window.speechSynthesis.speak(utter);
      speechState = "speaking";
      updateSpeechUi();
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
    try {
      synth.pause();
      speechState = "paused";
    } catch (_) {
      stopSpeech();
      return;
    }
  } else if (speechState === "paused") {
    try {
      synth.resume();
      speechState = "speaking";
    } catch (_) {
      stopSpeech();
      return;
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

function showLocation(lat, lng, label) {
  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (marker) marker.setLatLng([latNum, lngNum]);
  else marker = L.marker([latNum, lngNum]).addTo(map);

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
  };

  els.focusOptions.innerHTML = "";
  els.focusConfirm.classList.remove("visible");
  els.focusConfirm.textContent = "";
  els.reverseStatus.textContent = "Looking up address…";
  els.reverseStatus.classList.remove("error");
  clearStory();
  updateGenerateButton();
  reverseGeocode(latNum, lngNum, label);
}

function buildFocusOptions(address, displayName) {
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

async function reverseGeocode(lat, lng, fallbackLabel) {
  if (reverseAbort) reverseAbort.abort();
  reverseAbort = new AbortController();
  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?lat=" +
      encodeURIComponent(lat) +
      "&lon=" +
      encodeURIComponent(lng) +
      "&format=json&addressdetails=1&zoom=18";
    const res = await fetch(url, {
      headers: NOMINATIM_HEADERS,
      signal: reverseAbort.signal,
    });
    if (!res.ok) throw new Error("Reverse geocode failed");
    const data = await res.json();
    if (
      !currentSelection ||
      currentSelection.lat !== lat ||
      currentSelection.lng !== lng
    ) {
      return;
    }
    const address = data.address || {};
    const displayName = data.display_name || fallbackLabel || "";
    currentSelection.address = address;
    currentSelection.displayName = displayName;
    if (displayName) {
      els.placeName.textContent = displayName;
      els.placeName.hidden = false;
    }
    const options = buildFocusOptions(address, displayName);
    currentSelection.options = options;
    els.reverseStatus.textContent = "";
    renderFocusOptions(options);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    els.reverseStatus.textContent =
      "Could not look up address. You can still pick a focus from coordinates.";
    els.reverseStatus.classList.add("error");
    if (!currentSelection) return;
    const options = buildFocusOptions({}, fallbackLabel || "");
    currentSelection.options = options;
    renderFocusOptions(options);
  }
}

function placeYouAreHere(lat, lng) {
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
    setGeoBanner("Finding your location…");
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      placeYouAreHere(lat, lng);
      map.flyTo([lat, lng], 16, { duration: 1.2 });
      setGeoBanner(
        "Map centered on your location. Blue marker = you are here.",
        "ok"
      );
      els.locateBtn.disabled = false;
      if (fromButton) showLocation(lat, lng);
    },
    (err) => {
      els.locateBtn.disabled = false;
      let msg =
        "Location unavailable. You can still explore by clicking the map or searching.";
      if (err && err.code === 1) {
        msg =
          "Location permission denied. Click the map or search a place — the map still works.";
      } else if (err && err.code === 2) {
        msg =
          "Your location could not be determined. Click the map or search instead.";
      } else if (err && err.code === 3) {
        msg =
          "Location request timed out. Try “Use my location” again, or click/search.";
      }
      setGeoBanner(msg, "error");
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
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
      ? "Confirmed — researching with source checks…"
      : "Identifying place and researching with source checks…"
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

// —— Events ——
map.on("click", (e) => {
  showLocation(e.latlng.lat, e.latlng.lng);
  setStatus("");
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q) return;
  els.btn.disabled = true;
  setStatus("Searching…");
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(q) +
      "&format=json&addressdetails=1&limit=1";
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
    map.flyTo([lat, lng], 15, { duration: 1.2 });
    showLocation(lat, lng, hit.display_name);
    setStatus("");
  } catch (_) {
    setStatus("Search failed. Try again.", true);
  } finally {
    els.btn.disabled = false;
  }
});

els.locateBtn.addEventListener("click", () => requestLocation(true));
els.settingsBtn.addEventListener("click", () => openKeyModal(false));

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

requestLocation(false);
setTimeout(() => map.invalidateSize(), 0);
window.addEventListener("resize", () => map.invalidateSize());
