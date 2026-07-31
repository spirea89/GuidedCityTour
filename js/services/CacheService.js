import {
  CACHE_DB_NAME,
  CACHE_STORE,
  CACHE_TTL_MS,
  PIPELINE_VERSION,
  SUPABASE,
} from "../config.js";

/**
 * Tour cache contract (SOLID: depend on this interface, not a store).
 *
 * Implementations:
 * - IndexedDBCache — device-local only (GitHub Pages demo)
 * - SupabaseCache — shared cross-user cache via Worker or anon client (stub until wired)
 *
 * CacheService is an alias of IndexedDBCache for backward compatibility.
 *
 * @see docs/ai/supabase-cache.md
 */
export class TourCache {
  /**
   * @param {object} parts — { lat, lng, focus, categories, kids, v, placeId?, name? }
   * @returns {string}
   */
  makeKey(parts = {}) {
    return buildCacheKey(parts);
  }

  /** @returns {Promise<object|null>} */
  async get(_key) {
    throw new Error("TourCache.get not implemented");
  }

  /** @returns {Promise<boolean>} */
  async set(_key, _value, _ttlMs) {
    throw new Error("TourCache.set not implemented");
  }

  /** @returns {Promise<boolean>} */
  async invalidate(_prefix = "") {
    throw new Error("TourCache.invalidate not implemented");
  }
}

/**
 * Device-local IndexedDB tour cache. Does NOT share across visitors.
 */
export class IndexedDBCache extends TourCache {
  constructor(options = {}) {
    super();
    this.dbName = options.dbName || CACHE_DB_NAME;
    this.storeName = options.storeName || CACHE_STORE;
    this.defaultTtlMs = options.defaultTtlMs || CACHE_TTL_MS;
    this._dbPromise = null;
  }

  async get(key) {
    try {
      const db = await this._open();
      const row = await idbGet(db, this.storeName, key);
      if (!row) return null;
      if (row.expiresAt && Date.now() > row.expiresAt) {
        await idbDelete(db, this.storeName, key);
        return null;
      }
      return row.value;
    } catch (_) {
      return null;
    }
  }

  async set(key, value, ttlMs) {
    try {
      const db = await this._open();
      const expiresAt = Date.now() + (ttlMs || this.defaultTtlMs);
      await idbPut(db, this.storeName, {
        key,
        value,
        expiresAt,
        savedAt: Date.now(),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async invalidate(prefix = "") {
    try {
      const db = await this._open();
      const all = await idbGetAll(db, this.storeName);
      const jobs = [];
      for (const row of all) {
        if (!prefix || String(row.key).startsWith(prefix)) {
          jobs.push(idbDelete(db, this.storeName, row.key));
        }
      }
      await Promise.all(jobs);
      return true;
    } catch (_) {
      return false;
    }
  }

  _open() {
    if (this._dbPromise) return this._dbPromise;
    const storeName = this.storeName;
    this._dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IDB open failed"));
    });
    return this._dbPromise;
  }
}

/**
 * Shared Supabase-backed cache adapter (stub).
 *
 * Production wiring:
 * 1. Prefer Worker → Supabase service role (no anon key in browser for writes).
 * 2. Or set SUPABASE.url + SUPABASE.anonKey via runtime config (never commit secrets).
 * 3. Table: place_research — see docs/ai/supabase-cache.md
 *
 * Until configured, all methods no-op / return null so the pipeline stays local-only.
 */
export class SupabaseCache extends TourCache {
  constructor(options = {}) {
    super();
    this.url = options.url || (SUPABASE && SUPABASE.url) || "";
    this.anonKey = options.anonKey || (SUPABASE && SUPABASE.anonKey) || "";
    this.table = options.table || "place_research";
    this.defaultTtlMs = options.defaultTtlMs || CACHE_TTL_MS;
    this.enabled = !!(this.url && this.anonKey);
  }

  get configured() {
    return this.enabled;
  }

  async get(key) {
    if (!this.enabled) return null;
    try {
      const row = await this._rest(
        "GET",
        `?cache_key=eq.${encodeURIComponent(key)}&select=verified_payload,expires_at&limit=1`
      );
      if (!row || !row.length) return null;
      const first = row[0];
      if (first.expires_at && Date.parse(first.expires_at) < Date.now()) {
        return null;
      }
      return first.verified_payload || null;
    } catch (_) {
      return null;
    }
  }

  async set(key, value, ttlMs) {
    if (!this.enabled) return false;
    try {
      const ttl = ttlMs || this.defaultTtlMs;
      const now = new Date();
      const expires = new Date(now.getTime() + ttl);
      const body = [
        {
          cache_key: key,
          verified_payload: value,
          sources: (value && value.citations) || [],
          confidence:
            (value &&
              value.place &&
              value.place.identification_confidence) ||
            null,
          researched_at: now.toISOString(),
          expires_at: expires.toISOString(),
          pipeline_version:
            (value && value.meta && value.meta.pipeline_version) ||
            PIPELINE_VERSION,
        },
      ];
      await this._rest(
        "POST",
        "",
        body,
        { Prefer: "resolution=merge-duplicates,return=minimal" }
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  async invalidate(prefix = "") {
    if (!this.enabled) return false;
    try {
      if (!prefix) {
        await this._rest("DELETE", `?cache_key=neq.`);
        return true;
      }
      // Prefix delete requires RPC or Worker; stub documents limitation
      console.warn(
        "[SupabaseCache] Prefix invalidate needs Worker/RPC; skipped for:",
        prefix
      );
      return false;
    } catch (_) {
      return false;
    }
  }

  async _rest(method, queryPath, body, extraHeaders = {}) {
    const base = String(this.url).replace(/\/$/, "");
    const res = await fetch(
      base + "/rest/v1/" + this.table + (queryPath || ""),
      {
        method,
        headers: {
          apikey: this.anonKey,
          Authorization: "Bearer " + this.anonKey,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: body != null ? JSON.stringify(body) : undefined,
      }
    );
    if (!res.ok) {
      throw new Error("Supabase REST " + res.status);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  }
}

/**
 * Reads local first, then optional shared Supabase; writes to both when shared is configured.
 * Typical production path: Worker owns Supabase; browser uses IndexedDB only.
 */
export class CompositeCache extends TourCache {
  constructor({ local, shared } = {}) {
    super();
    this.local = local || new IndexedDBCache();
    this.shared = shared || null;
  }

  makeKey(parts = {}) {
    return this.local.makeKey(parts);
  }

  async get(key) {
    const localHit = await this.local.get(key);
    if (localHit) return localHit;
    if (this.shared && this.shared.configured) {
      const remote = await this.shared.get(key);
      if (remote) {
        await this.local.set(key, remote);
        return remote;
      }
    }
    return null;
  }

  async set(key, value, ttlMs) {
    const a = await this.local.set(key, value, ttlMs);
    let b = true;
    if (this.shared && this.shared.configured) {
      b = await this.shared.set(key, value, ttlMs);
    }
    return a || b;
  }

  async invalidate(prefix = "") {
    const a = await this.local.invalidate(prefix);
    let b = true;
    if (this.shared && this.shared.configured) {
      b = await this.shared.invalidate(prefix);
    }
    return a && b;
  }
}

/** @deprecated Prefer IndexedDBCache / createTourCache(); kept as alias. */
export class CacheService extends IndexedDBCache {}

/**
 * Factory: IndexedDB by default; Composite when SUPABASE is configured at runtime.
 */
export function createTourCache(options = {}) {
  const local = new IndexedDBCache(options);
  const shared = new SupabaseCache(options.supabase || {});
  if (shared.configured) {
    return new CompositeCache({ local, shared });
  }
  return local;
}

export function buildCacheKey(parts = {}) {
  const lat = roundCoord(parts.lat);
  const lng = roundCoord(parts.lng);
  const focus = String(parts.focus || "none");
  const cats = String(parts.categories || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(",");
  const kids = parts.kids ? "1" : "0";
  const v = String(parts.v || PIPELINE_VERSION || "2");
  // Prefer stable place_id when available (OSM/Wikidata); else geohash-ish lat5+lng5+name
  if (parts.placeId) {
    return `gct:v${v}:id:${parts.placeId}:${focus}:${cats}:${kids}`;
  }
  const nameSlug = String(parts.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48);
  if (nameSlug) {
    return `gct:v${v}:${lat}:${lng}:${nameSlug}:${focus}:${cats}:${kids}`;
  }
  return `gct:v${v}:${lat}:${lng}:${focus}:${cats}:${kids}`;
}

function roundCoord(n) {
  return Number(n).toFixed(5);
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(record);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
