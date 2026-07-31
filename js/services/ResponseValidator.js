import {
  VALID_STATUSES,
  STATUS,
  CLAIM_CATEGORIES,
  SOURCE_TIERS,
} from "../schemas/tourResponseSchema.js";
import { createTourResult, emptyClaims, emptyNarration } from "../models/tourResult.js";
import { PIPELINE_VERSION } from "../config.js";

/**
 * Validates and normalizes TourResponse JSON before UI display.
 */
export class ResponseValidator {
  validate(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object") {
      return { ok: false, errors: ["Payload is not an object"], normalized: null };
    }

    const status = String(payload.status || "");
    if (!VALID_STATUSES.has(status)) {
      errors.push("Invalid or missing status");
    }

    if (!payload.place || typeof payload.place !== "object") {
      errors.push("Missing place");
    } else {
      if (typeof payload.place.identification_confidence !== "number") {
        errors.push("place.identification_confidence must be a number");
      }
      if (typeof payload.place.lat !== "number" || typeof payload.place.lng !== "number") {
        errors.push("place.lat/lng must be numbers");
      }
    }

    const claims = payload.claims || {};
    for (const bucket of ["verified", "uncertain", "legends"]) {
      if (claims[bucket] != null && !Array.isArray(claims[bucket])) {
        errors.push("claims." + bucket + " must be an array");
      }
    }
    if (claims.unknown != null && !Array.isArray(claims.unknown)) {
      errors.push("claims.unknown must be an array");
    }

    const verified = Array.isArray(claims.verified) ? claims.verified : [];
    verified.forEach((c, i) => {
      if (!c || !String(c.text || "").trim()) {
        errors.push("verified[" + i + "] missing text");
      }
      const sources = (c && c.sources) || [];
      if (status === STATUS.OK && (!Array.isArray(sources) || !sources.length)) {
        errors.push("verified[" + i + "] requires sources when status=ok");
      }
    });

    if (
      status === STATUS.OK &&
      verified.length === 0 &&
      !(payload.narration && String(payload.narration.adult || "").trim())
    ) {
      errors.push("status=ok requires verified claims or adult narration");
    }

    const researchMode =
      payload.research && payload.research.mode
        ? payload.research.mode
        : "none";
    if (researchMode === "degraded" && verified.length > 0) {
      errors.push("degraded research must not produce verified claims");
    }

    const normalized = this.normalize(payload);
    return { ok: errors.length === 0, errors, normalized };
  }

  normalize(payload) {
    const claimsIn = payload.claims || {};
    const claims = emptyClaims();
    claims.verified = normalizeClaimList(claimsIn.verified);
    claims.uncertain = normalizeClaimList(claimsIn.uncertain);
    claims.legends = normalizeClaimList(claimsIn.legends);
    claims.unknown = Array.isArray(claimsIn.unknown)
      ? claimsIn.unknown.map((u) => String(u)).filter(Boolean)
      : [];

    const narrationIn = payload.narration || {};
    const narration = emptyNarration();
    narration.adult = String(narrationIn.adult || "").trim();
    narration.kids = String(narrationIn.kids || "").trim();
    const sec = narrationIn.sections || {};
    for (const k of Object.keys(narration.sections)) {
      narration.sections[k] = String(sec[k] || "").trim();
    }

    const citations = Array.isArray(payload.citations)
      ? payload.citations.map(normalizeSource).filter(Boolean)
      : [];

    // Backfill citations from verified sources
    if (!citations.length) {
      const seen = new Set();
      for (const c of claims.verified) {
        for (const s of c.sources || []) {
          const key = (s.url || s.title || "").toLowerCase();
          if (key && !seen.has(key)) {
            seen.add(key);
            citations.push(s);
          }
        }
      }
    }

    const place = payload.place
      ? {
          id: String(payload.place.id || ""),
          name: String(payload.place.name || ""),
          entity_type: String(payload.place.entity_type || "unknown"),
          lat: Number(payload.place.lat) || 0,
          lng: Number(payload.place.lng) || 0,
          address: payload.place.address || {},
          identification_confidence: clamp01(
            Number(payload.place.identification_confidence) || 0
          ),
          candidates: Array.isArray(payload.place.candidates)
            ? payload.place.candidates
            : [],
          nearby_allow_list: Array.isArray(payload.place.nearby_allow_list)
            ? payload.place.nearby_allow_list
            : [],
        }
      : null;

    return createTourResult({
      status: VALID_STATUSES.has(payload.status) ? payload.status : STATUS.ERROR,
      message: String(payload.message || ""),
      place,
      research: {
        mode: (payload.research && payload.research.mode) || "none",
        queries: (payload.research && payload.research.queries) || [],
        sources_consulted:
          (payload.research && payload.research.sources_consulted) || [],
      },
      claims,
      narration,
      citations,
      errors: Array.isArray(payload.errors) ? payload.errors.map(String) : [],
      meta: {
        pipeline_version:
          (payload.meta && payload.meta.pipeline_version) || PIPELINE_VERSION,
        model: (payload.meta && payload.meta.model) || "",
        cached: !!(payload.meta && payload.meta.cached),
        generated_at:
          (payload.meta && payload.meta.generated_at) ||
          new Date().toISOString(),
        research_available: !!(payload.meta && payload.meta.research_available),
      },
    });
  }

  /**
   * Parse model text that should be JSON (strip fences if present).
   */
  parseJsonText(text) {
    if (!text || typeof text !== "string") {
      return { ok: false, error: "Empty model text", value: null };
    }
    let raw = text.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    try {
      return { ok: true, value: JSON.parse(raw), error: null };
    } catch (err) {
      // Try to extract first {...} block
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return {
            ok: true,
            value: JSON.parse(raw.slice(start, end + 1)),
            error: null,
          };
        } catch (_) {
          /* fall through */
        }
      }
      return {
        ok: false,
        error: (err && err.message) || "JSON parse failed",
        value: null,
      };
    }
  }
}

function normalizeSource(s) {
  if (!s || typeof s !== "object") return null;
  const title = String(s.title || "").trim();
  if (!title && !s.url) return null;
  const tier = SOURCE_TIERS.has(s.tier) ? s.tier : "other";
  return {
    title: title || s.url || "Source",
    url: String(s.url || "").trim(),
    publisher: String(s.publisher || "").trim(),
    tier,
  };
}

function normalizeClaimList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const text = String(c.text || "").trim();
      if (!text) return null;
      const category = CLAIM_CATEGORIES.has(c.category) ? c.category : "other";
      const sources = Array.isArray(c.sources)
        ? c.sources.map(normalizeSource).filter(Boolean)
        : [];
      return {
        text,
        confidence: clamp01(Number(c.confidence) || 0),
        category,
        sources,
      };
    })
    .filter(Boolean);
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
