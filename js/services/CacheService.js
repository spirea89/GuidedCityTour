import { CACHE_DB_NAME, CACHE_STORE, CACHE_TTL_MS } from "../config.js";

/**
 * Client-side tour cache (IndexedDB). Per-browser only.
 * Production shared cache belongs on a Worker/KV — see docs/ai/backend-interfaces.md.
 */
export class CacheService {
  constructor(options = {}) {
    this.dbName = options.dbName || CACHE_DB_NAME;
    this.storeName = options.storeName || CACHE_STORE;
    this.defaultTtlMs = options.defaultTtlMs || CACHE_TTL_MS;
    this._dbPromise = null;
  }

  makeKey(parts = {}) {
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
    const v = String(parts.v || "2");
    return `gct:v${v}:${lat}:${lng}:${focus}:${cats}:${kids}`;
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
