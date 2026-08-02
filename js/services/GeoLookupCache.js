/**
 * Short-lived memory (+ optional IndexedDB) cache for reverse geocode
 * and nearby-landmark lookups, keyed by rounded lat/lng.
 */
import { CACHE_DB_NAME } from "../config.js";

const MEM_TTL_MS = 30 * 60 * 1000;
const IDB_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MEM = 100;
const COORD_DECIMALS = 4; // ~11 m
const GEO_STORE = "geo_lookups";

const memory = new Map();
const inflight = new Map();
let dbPromise = null;

export function roundGeoCoord(n) {
  return Number(n).toFixed(COORD_DECIMALS);
}

export function geoCacheKey(kind, lat, lng) {
  return String(kind) + ":" + roundGeoCoord(lat) + ":" + roundGeoCoord(lng);
}

function touchMem(key, entry) {
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MAX_MEM) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
}

export function geoMemGet(key) {
  const row = memory.get(key);
  if (!row) return undefined;
  if (row.expiresAt && Date.now() > row.expiresAt) {
    memory.delete(key);
    return undefined;
  }
  touchMem(key, row);
  return row.value;
}

export function geoMemSet(key, value, ttlMs) {
  touchMem(key, {
    value,
    expiresAt: Date.now() + (ttlMs || MEM_TTL_MS),
  });
}

function openGeoDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    // Separate DB so we do not bump the tour-cache schema version.
    const req = indexedDB.open(CACHE_DB_NAME + "_geo", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GEO_STORE)) {
        db.createObjectStore(GEO_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IDB open failed"));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

export async function geoIdbGet(key) {
  try {
    const db = await openGeoDb();
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(GEO_STORE, "readonly");
      const req = tx.objectStore(GEO_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!row) return undefined;
    if (row.expiresAt && Date.now() > row.expiresAt) {
      geoIdbDelete(key);
      return undefined;
    }
    return row.value;
  } catch (_) {
    return undefined;
  }
}

export function geoIdbSet(key, value, ttlMs) {
  openGeoDb()
    .then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(GEO_STORE, "readwrite");
        tx.objectStore(GEO_STORE).put({
          key,
          value,
          expiresAt: Date.now() + (ttlMs || IDB_TTL_MS),
          savedAt: Date.now(),
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    })
    .catch(() => undefined);
}

function geoIdbDelete(key) {
  openGeoDb()
    .then((db) => {
      const tx = db.transaction(GEO_STORE, "readwrite");
      tx.objectStore(GEO_STORE).delete(key);
    })
    .catch(() => undefined);
}

/**
 * Deduplicate concurrent lookups for the same key; honor AbortSignal.
 * Memory hit is sync-fast; IndexedDB is checked inside the shared fetcher.
 * Aborting one waiter does not cancel the shared network request until
 * every waiter has aborted (so reverse + chips can share one Overpass call).
 *
 * @param {string} key
 * @param {(signal: AbortSignal) => Promise<any>} fetcher
 * @param {AbortSignal} [signal]
 */
export async function geoCachedFetch(key, fetcher, signal) {
  const memHit = geoMemGet(key);
  if (memHit !== undefined) return memHit;

  let entry = inflight.get(key);
  if (!entry) {
    const ctrl = new AbortController();
    entry = { ctrl: ctrl, waiters: 0, promise: null };
    entry.promise = (async () => {
      const idbHit = await geoIdbGet(key);
      if (idbHit !== undefined) {
        geoMemSet(key, idbHit);
        return idbHit;
      }
      const value = await fetcher(ctrl.signal);
      const emptyList = Array.isArray(value) && value.length === 0;
      // Avoid sticky empty landmark misses when Overpass is briefly down.
      const ttl = emptyList ? 60 * 1000 : undefined;
      geoMemSet(key, value, ttl);
      if (!emptyList) geoIdbSet(key, value);
      return value;
    })().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, entry);
  }

  entry.waiters += 1;
  let waiterReleased = false;
  const releaseWaiter = () => {
    if (waiterReleased) return;
    waiterReleased = true;
    entry.waiters -= 1;
    if (entry.waiters <= 0) {
      try {
        entry.ctrl.abort();
      } catch (_) {
        /* ignore */
      }
    }
  };

  const onAbort = () => {
    releaseWaiter();
  };

  if (signal) {
    if (signal.aborted) {
      releaseWaiter();
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const value = await entry.promise;
    if (signal && signal.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    return value;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    // Successful waiter: keep the shared result; only abort when all leave early.
    if (!(signal && signal.aborted)) {
      // Mark released without aborting an in-flight request still useful for cache fill.
      if (!waiterReleased) {
        waiterReleased = true;
        entry.waiters -= 1;
      }
    }
  }
}
