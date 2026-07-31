import { emptyClaims } from "../models/tourResult.js";
import { STATUS } from "../schemas/tourResponseSchema.js";

/**
 * Post-processes research packets into strict claim buckets.
 * Drops bogus "verified" claims when research was degraded.
 */
export class FactVerifier {
  extract(packet, place, options = {}) {
    const claims = emptyClaims();
    const raw = (packet && packet.claims) || {};
    const mode = (packet && packet.research && packet.research.mode) || "none";
    const degraded = mode === "degraded" || mode === "none";

    const verifiedIn = Array.isArray(raw.verified)
      ? raw.verified
      : Array.isArray(packet && packet.verifiedFacts)
        ? packet.verifiedFacts
        : [];
    const uncertainIn = Array.isArray(raw.uncertain)
      ? raw.uncertain
      : Array.isArray(packet && packet.uncertainFacts)
        ? packet.uncertainFacts
        : [];
    const legendsIn = Array.isArray(raw.legends) ? raw.legends : [];
    const unknownIn = Array.isArray(raw.unknown) ? raw.unknown : [];

    for (const c of verifiedIn) {
      const claim = normalizeClaim(c);
      if (!claim) continue;
      if (degraded) {
        claims.unknown.push(
          "Unverified (research unavailable): " + claim.text
        );
        continue;
      }
      if (!claim.sources.length) {
        claims.uncertain.push({ ...claim, confidence: Math.min(claim.confidence, 0.4) });
        continue;
      }
      if (claim.confidence < 0.5) {
        claims.uncertain.push(claim);
        continue;
      }
      claims.verified.push(claim);
    }

    for (const c of uncertainIn) {
      const claim = normalizeClaim(c);
      if (claim) claims.uncertain.push(claim);
    }
    for (const c of legendsIn) {
      const claim = normalizeClaim(c);
      if (claim) claims.legends.push(claim);
    }
    for (const u of unknownIn) {
      if (u) claims.unknown.push(String(u));
    }

    let status = (packet && packet.status) || STATUS.OK;
    let message = (packet && packet.message) || "";

    if (degraded) {
      status = STATUS.WEB_SEARCH_UNAVAILABLE;
      claims.verified = [];
    } else if (
      options.forceConflict ||
      status === STATUS.SOURCE_CONFLICT
    ) {
      status = STATUS.SOURCE_CONFLICT;
      message =
        message ||
        "Sources disagree on important facts. Showing conflict instead of picking a side.";
    } else if (claims.verified.length === 0 && !degraded) {
      status = STATUS.NO_HISTORY;
      message =
        message ||
        "No well-sourced historical claims found for this place yet.";
      if (!claims.unknown.length) {
        claims.unknown.push(
          "No authoritative sources returned clear history for this exact place."
        );
      }
    } else if (claims.verified.length > 0) {
      status = STATUS.OK;
    }

    // Detect simple conflicts: same category contradictory high-confidence uncertain pairs
    // (lightweight heuristic — full NLI deferred to backend)
    const conflictHint = detectConflictHint(claims);
    if (conflictHint) {
      status = STATUS.SOURCE_CONFLICT;
      message = conflictHint;
    }

    return {
      status,
      message,
      claims,
      place,
      research: (packet && packet.research) || { mode, queries: [], sources_consulted: [] },
      narrationSeed: (packet && packet.narration) || null,
      citationsSeed: (packet && packet.citations) || [],
      meta: (packet && packet.meta) || {},
    };
  }
}

function normalizeClaim(c) {
  if (!c || typeof c !== "object") return null;
  const text = String(c.text || "").trim();
  if (!text) return null;
  const sources = Array.isArray(c.sources)
    ? c.sources
        .map((s) => {
          if (!s) return null;
          const title = String(s.title || s.url || "").trim();
          if (!title) return null;
          return {
            title,
            url: String(s.url || "").trim(),
            publisher: String(s.publisher || "").trim(),
            tier: s.tier || "other",
          };
        })
        .filter(Boolean)
    : [];
  return {
    text,
    confidence: clamp01(Number(c.confidence) || 0),
    category: (() => {
      let cat = c.category || "other";
      if (cat === "personalities" || cat === "people") cat = "famous_people";
      return cat;
    })(),
    sources,
  };
}

function detectConflictHint(claims) {
  // If model already put conflicting statements in uncertain with high confidence
  const high = (claims.uncertain || []).filter((c) => c.confidence >= 0.7);
  if (high.length >= 2) {
    return (
      "Possible source conflict: multiple uncertain high-confidence claims. " +
      "Review citations before treating any as settled fact."
    );
  }
  return "";
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
