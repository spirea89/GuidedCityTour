# TourResponse JSON schema

Validated by `ResponseValidator` before any UI render. Improved from a minimal sketch to support Place/POI generality, claim provenance, error statuses, and kids mode.

## Status enum

```
ok | needs_confirmation | unidentified | no_history | source_conflict
| ambiguous_name | offline | web_search_unavailable | error
```

## Entity types

```
building | street | neighbourhood | museum | statue | church | castle
| restaurant | trail | landmark | place | unknown
```

## Schema (JSON Schema–like)

```json
{
  "$id": "https://guidedcitytour.local/schemas/tour-response.json",
  "type": "object",
  "required": ["status", "place", "claims", "narration", "citations", "meta"],
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok",
        "needs_confirmation",
        "unidentified",
        "no_history",
        "source_conflict",
        "ambiguous_name",
        "offline",
        "web_search_unavailable",
        "error"
      ]
    },
    "message": {
      "type": "string",
      "description": "Human-readable status detail for UI"
    },
    "place": {
      "type": "object",
      "required": ["name", "entity_type", "lat", "lng", "identification_confidence"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "entity_type": { "type": "string" },
        "lat": { "type": "number" },
        "lng": { "type": "number" },
        "address": { "type": "object" },
        "identification_confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "candidates": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "entity_type": { "type": "string" },
              "confidence": { "type": "number" },
              "reason": { "type": "string" }
            }
          }
        },
        "nearby_allow_list": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "dist_m": { "type": "number" },
              "type": { "type": "string" }
            }
          }
        }
      }
    },
    "research": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": ["web_search", "cached", "degraded", "none"]
        },
        "queries": { "type": "array", "items": { "type": "string" } },
        "sources_consulted": {
          "type": "array",
          "items": { "$ref": "#/$defs/source" }
        }
      }
    },
    "claims": {
      "type": "object",
      "required": ["verified", "uncertain", "legends", "unknown"],
      "properties": {
        "verified": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
        "uncertain": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
        "legends": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
        "unknown": { "type": "array", "items": { "type": "string" } }
      }
    },
    "narration": {
      "type": "object",
      "properties": {
        "adult": { "type": "string" },
        "kids": { "type": "string" },
        "sections": {
          "type": "object",
          "properties": {
            "history": { "type": "string" },
            "architecture": { "type": "string" },
            "famous_people": { "type": "string" },
            "interesting_facts": { "type": "string" },
            "today": { "type": "string" }
          }
        }
      }
    },
    "citations": {
      "type": "array",
      "items": { "$ref": "#/$defs/source" }
    },
    "errors": {
      "type": "array",
      "items": { "type": "string" }
    },
    "meta": {
      "type": "object",
      "required": ["pipeline_version"],
      "properties": {
        "pipeline_version": { "type": "string" },
        "model": { "type": "string" },
        "cached": { "type": "boolean" },
        "generated_at": { "type": "string" },
        "research_available": { "type": "boolean" }
      }
    }
  },
  "$defs": {
    "source": {
      "type": "object",
      "required": ["title"],
      "properties": {
        "title": { "type": "string" },
        "url": { "type": "string" },
        "publisher": { "type": "string" },
        "tier": {
          "type": "string",
          "enum": ["official", "academic", "museum", "news", "other"]
        }
      }
    },
    "claim": {
      "type": "object",
      "required": ["text", "confidence"],
      "properties": {
        "text": { "type": "string" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "category": {
          "type": "string",
          "enum": [
            "history",
            "architecture",
            "famous_people",
            "interesting_facts",
            "today",
            "other"
          ]
        },
        "sources": {
          "type": "array",
          "items": { "$ref": "#/$defs/source" }
        }
      }
    }
  }
}
```

## Validation rules (application-level)

1. If `status === "ok"`, `claims.verified.length >= 1` OR `narration.adult` explains `no_history` honestly (prefer `status: no_history`).
2. Every `claims.verified[]` item must have `sources.length >= 1` with a non-empty `title` (url strongly preferred).
3. `narration.kids` must not introduce facts absent from `claims.verified`.
4. `identification_confidence < 0.55` ⇒ status should be `needs_confirmation` or `ambiguous_name`, not `ok`.
5. Reject payloads that put training-memory “facts” into `verified` when `research.mode === "degraded"`.
