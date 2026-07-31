/**
 * MapLibre GL mobile map: pitched "street view" feel, optional 3D buildings,
 * compass bearing, and tap-to-select. Free OpenFreeMap tiles (no API key).
 *
 * Limitations: fill-extrusion depends on OpenFreeMap planet building data;
 * if extrusion fails we keep pitch + nearby POI chips from the app shell.
 */
import { DEFAULT_MAP } from "../config.js";

export const OPENFREEMAP_STYLE =
  "https://tiles.openfreemap.org/styles/liberty";
export const OPENFREEMAP_TILES =
  "https://tiles.openfreemap.org/planet";

const BUILDING_LAYER_ID = "gct-3d-buildings";
const YOU_HERE_SOURCE = "gct-you-here";
const SELECT_SOURCE = "gct-selection";

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container
 * @param {(lat: number, lng: number, meta?: object) => void} opts.onSelect
 * @param {(info: { has3d: boolean }) => void} [opts.onReady]
 * @param {(err: Error) => void} [opts.onFail]
 */
export function createMobileMap(opts) {
  const container = opts.container;
  const onSelect = opts.onSelect;
  const onReady = opts.onReady || function () {};
  const onFail = opts.onFail || function () {};

  if (typeof maplibregl === "undefined") {
    const err = new Error("MapLibre GL JS did not load");
    onFail(err);
    return null;
  }

  let map = null;
  let has3d = false;
  let youMarker = null;
  let selectMarker = null;
  let compassActive = false;
  let orientationHandler = null;
  let destroyed = false;

  try {
    map = new maplibregl.Map({
      container: container,
      style: OPENFREEMAP_STYLE,
      center: [DEFAULT_MAP.lng, DEFAULT_MAP.lat],
      zoom: 16.5,
      pitch: 60,
      bearing: 0,
      maxPitch: 70,
      antialias: true,
      attributionControl: true,
    });
  } catch (err) {
    onFail(err instanceof Error ? err : new Error(String(err)));
    return null;
  }

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

  map.on("error", function (e) {
    // Style/tile errors are non-fatal; only fail hard if map never loads.
    if (e && e.error) {
      console.warn("[MobileMap]", e.error.message || e.error);
    }
  });

  map.on("load", function () {
    if (destroyed) return;
    try {
      has3d = addBuildingExtrusions(map);
    } catch (err) {
      console.warn("[MobileMap] 3D buildings unavailable:", err);
      has3d = false;
    }
    ensurePointSources(map);
    onReady({ has3d: has3d });
  });

  map.on("click", function (e) {
    if (!e || !e.lngLat) return;
    let meta = null;
    try {
      const feats = map.queryRenderedFeatures(e.point, {
        layers: layersForPick(map),
      });
      if (feats && feats.length) {
        const f = feats[0];
        const props = f.properties || {};
        const name =
          props.name ||
          props.name_en ||
          props["name:en"] ||
          "";
        meta = {
          name: name ? String(name).trim() : "",
          layer: f.layer && f.layer.id ? f.layer.id : "",
          isBuilding: !!(
            f.layer &&
            (f.layer.id === BUILDING_LAYER_ID ||
              String(f.layer.id).indexOf("building") !== -1)
          ),
        };
      }
    } catch (_) {
      /* ignore query errors */
    }
    onSelect(e.lngLat.lat, e.lngLat.lng, meta || {});
  });

  function setCenter(lat, lng, zoom) {
    if (!map) return;
    const z = zoom != null ? zoom : map.getZoom();
    map.easeTo({
      center: [lng, lat],
      zoom: z,
      pitch: 60,
      duration: 900,
    });
  }

  function flyTo(lat, lng, zoom) {
    if (!map) return;
    map.flyTo({
      center: [lng, lat],
      zoom: zoom != null ? zoom : 17,
      pitch: 60,
      essential: true,
    });
  }

  function placeYouAreHere(lat, lng) {
    if (!map) return;
    const data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {},
        },
      ],
    };
    const src = map.getSource(YOU_HERE_SOURCE);
    if (src) src.setData(data);
    if (!youMarker) {
      const el = document.createElement("div");
      el.className = "you-are-here-dot";
      el.title = "You are here";
      youMarker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      youMarker.setLngLat([lng, lat]);
    }
  }

  function placeSelection(lat, lng) {
    if (!map) return;
    if (!selectMarker) {
      selectMarker = new maplibregl.Marker({ color: "#3db8a8" })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      selectMarker.setLngLat([lng, lat]);
    }
  }

  function setBearing(deg) {
    if (!map || !isFinite(deg)) return;
    map.easeTo({ bearing: deg, duration: 280, pitch: map.getPitch() });
  }

  function resize() {
    if (map) map.resize();
  }

  function getMap() {
    return map;
  }

  function getHas3d() {
    return has3d;
  }

  function destroy() {
    destroyed = true;
    stopCompass();
    if (youMarker) {
      youMarker.remove();
      youMarker = null;
    }
    if (selectMarker) {
      selectMarker.remove();
      selectMarker = null;
    }
    if (map) {
      try {
        map.remove();
      } catch (_) {
        /* ignore */
      }
      map = null;
    }
  }

  /**
   * Optional device compass. iOS 13+ needs a user-gesture permission call.
   * @returns {Promise<boolean>}
   */
  async function startCompass() {
    if (compassActive) return true;
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state !== "granted") return false;
      } catch (_) {
        return false;
      }
    }
    if (typeof window.DeviceOrientationEvent === "undefined") return false;

    orientationHandler = function (ev) {
      if (!map || destroyed) return;
      let heading = null;
      if (ev.webkitCompassHeading != null && isFinite(ev.webkitCompassHeading)) {
        heading = ev.webkitCompassHeading;
      } else if (ev.alpha != null && isFinite(ev.alpha)) {
        // alpha: 0 = north when device is upright (approx); invert for map bearing
        heading = 360 - ev.alpha;
      }
      if (heading == null) return;
      // Only nudge when user is not actively rotating the map
      if (map.isMoving && map.isMoving()) return;
      map.setBearing(heading);
    };
    window.addEventListener("deviceorientation", orientationHandler, true);
    compassActive = true;
    return true;
  }

  function stopCompass() {
    if (orientationHandler) {
      window.removeEventListener("deviceorientation", orientationHandler, true);
      orientationHandler = null;
    }
    compassActive = false;
  }

  return {
    setCenter: setCenter,
    flyTo: flyTo,
    placeYouAreHere: placeYouAreHere,
    placeSelection: placeSelection,
    setBearing: setBearing,
    resize: resize,
    getMap: getMap,
    getHas3d: getHas3d,
    startCompass: startCompass,
    stopCompass: stopCompass,
    destroy: destroy,
  };
}

function layersForPick(map) {
  const style = map.getStyle();
  if (!style || !style.layers) return undefined;
  const ids = [];
  for (let i = 0; i < style.layers.length; i++) {
    const id = style.layers[i].id;
    if (!id) continue;
    const lower = String(id).toLowerCase();
    if (
      lower.indexOf("building") !== -1 ||
      lower.indexOf("poi") !== -1 ||
      lower.indexOf("label") !== -1 ||
      lower.indexOf("place") !== -1
    ) {
      ids.push(id);
    }
  }
  if (map.getLayer(BUILDING_LAYER_ID)) ids.push(BUILDING_LAYER_ID);
  return ids.length ? ids : undefined;
}

function ensurePointSources(map) {
  if (!map.getSource(YOU_HERE_SOURCE)) {
    map.addSource(YOU_HERE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource(SELECT_SOURCE)) {
    map.addSource(SELECT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
}

/**
 * Add fill-extrusion buildings from OpenFreeMap planet tiles.
 * @returns {boolean} true if layer was added
 */
function addBuildingExtrusions(map) {
  if (map.getLayer(BUILDING_LAYER_ID)) return true;

  const style = map.getStyle();
  const layers = (style && style.layers) || [];

  // Prefer existing vector source that already has a building layer
  let sourceId = null;
  let sourceLayer = "building";
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (!L || L.type === "background") continue;
    const sl = String(L["source-layer"] || "").toLowerCase();
    if (sl === "building" && L.source) {
      sourceId = L.source;
      sourceLayer = L["source-layer"] || "building";
      break;
    }
  }

  if (!sourceId) {
    if (!map.getSource("openfreemap")) {
      map.addSource("openfreemap", {
        type: "vector",
        url: OPENFREEMAP_TILES,
      });
    }
    sourceId = "openfreemap";
    sourceLayer = "building";
  }

  let labelLayerId = null;
  for (let i = 0; i < layers.length; i++) {
    if (
      layers[i].type === "symbol" &&
      layers[i].layout &&
      layers[i].layout["text-field"]
    ) {
      labelLayerId = layers[i].id;
      break;
    }
  }

  const layerDef = {
    id: BUILDING_LAYER_ID,
    source: sourceId,
    "source-layer": sourceLayer,
    type: "fill-extrusion",
    minzoom: 14,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-color": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "render_height"], ["get", "height"], 10],
        0,
        "#8fa0b8",
        40,
        "#6b7c94",
        120,
        "#4a5a72",
      ],
      "fill-extrusion-height": [
        "interpolate",
        ["linear"],
        ["zoom"],
        14,
        0,
        15.5,
        [
          "coalesce",
          ["get", "render_height"],
          ["get", "height"],
          12,
        ],
      ],
      "fill-extrusion-base": [
        "coalesce",
        ["get", "render_min_height"],
        ["get", "min_height"],
        0,
      ],
      "fill-extrusion-opacity": 0.85,
    },
  };

  if (labelLayerId) {
    map.addLayer(layerDef, labelLayerId);
  } else {
    map.addLayer(layerDef);
  }
  return true;
}

/**
 * Dynamically load MapLibre GL JS + CSS from CDN if not already present.
 * @returns {Promise<void>}
 */
export function loadMapLibreFromCdn() {
  if (typeof maplibregl !== "undefined") {
    return Promise.resolve();
  }
  return new Promise(function (resolve, reject) {
    const cssHref =
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
    const jsSrc =
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

    if (!document.querySelector('link[data-gct-maplibre-css]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssHref;
      link.setAttribute("data-gct-maplibre-css", "1");
      document.head.appendChild(link);
    }

    const existing = document.querySelector("script[data-gct-maplibre-js]");
    if (existing) {
      existing.addEventListener("load", function () {
        resolve();
      });
      existing.addEventListener("error", function () {
        reject(new Error("MapLibre script failed to load"));
      });
      if (typeof maplibregl !== "undefined") resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = jsSrc;
    script.async = true;
    script.setAttribute("data-gct-maplibre-js", "1");
    script.onload = function () {
      if (typeof maplibregl === "undefined") {
        reject(new Error("MapLibre global missing after load"));
      } else {
        resolve();
      }
    };
    script.onerror = function () {
      reject(new Error("MapLibre script failed to load"));
    };
    document.head.appendChild(script);
  });
}
