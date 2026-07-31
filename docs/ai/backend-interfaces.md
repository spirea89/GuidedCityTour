# Backend interfaces & production recommendations

## Why a backend

GitHub Pages is static. Two production needs usually break in pure browser mode:

1. **CORS / product policy** — OpenAI **Responses API** with the **`web_search`** tool is not reliably callable cross-origin from arbitrary static origins. Chat Completions with a user key often works; web-grounded research often does not.
2. **Shared cache & cost** — Per-browser IndexedDB does not help the next visitor. A Worker + **Supabase** (or KV) collapses repeat research for famous POIs.

Design the client against interfaces below so swapping `baseUrl` / `tourEndpoint` to a Worker is a config change. See [supabase-cache.md](./supabase-cache.md).

---

## Recommended Worker API

Base: `https://gct-api.<your-account>.workers.dev` (example)

### `POST /v1/tour`

Request:

```json
{
  "place": {
    "lat": 48.2084,
    "lng": 16.3731,
    "focus": { "kind": "house", "label": "…" },
    "address": {},
    "nearby_allow_list": []
  },
  "categories": ["history", "architecture", "famous_people", "today"],
  "kids_mode": false,
  "client_cache_buster": null
}
```

Response: `TourResponse` JSON (see [json-schema.md](./json-schema.md)).

### `POST /v1/research` (optional internal)

Runs Responses + `web_search` only; returns research packet for debugging.

### Headers

- `Authorization: Bearer <session or site token>` (not the OpenAI key in production)
- `Content-Type: application/json`

### Worker responsibilities

1. Hold `OPENAI_API_KEY` in secrets.
2. Call Responses API with `web_search` tool.
3. Validate output with the same schema rules.
4. Cache by normalized place key in **Supabase** `place_research` (TTL 14–30 days); optional KV hot layer.
5. Rate-limit by IP / auth token.
6. Strip/avoid logging full prompts with PII beyond coords + place name.

---

## Client configuration hook

```js
// js/config.js
export const API = {
  // null = call OpenAI from browser with user key (Pages demo mode)
  tourEndpoint: null, // e.g. "https://gct-api.example.workers.dev/v1/tour"
  openAiBase: "https://api.openai.com/v1",
};

export const SUPABASE = {
  url: "",      // never commit real values
  anonKey: "",  // prefer Worker service role for writes
};
```

When `tourEndpoint` is set, `TourPipeline` POSTs there and skips exposing the OpenAI key from the browser.

---

## CORS

| Call | Typical browser result |
|------|------------------------|
| Nominatim | OK with User-Agent/Accept etiquette |
| OpenAI Chat Completions + user key | Usually OK |
| OpenAI Responses + web_search | Often blocked or unsuitable — **proxy** |
| Worker same-site or ACAO allowlist | OK |

Worker should send:

```
Access-Control-Allow-Origin: https://spirea89.github.io
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
```

---

## Rate limits & cost

| Lever | Suggestion |
|-------|------------|
| Cache | 7d IndexedDB / 14–30d Supabase for high-confidence places |
| Model | `gpt-4o` quality narration; `gpt-4o-mini` for kids rewrite or economy |
| Max tokens | Cap narration ~1200–1600; research extraction ~2000–3500 |
| Concurrency | 1 in-flight tour per browser tab; Worker 10–60 req/min/IP |
| Categories | Fewer categories → cheaper / shorter research |
| Shared hits | Primary cost control — research once per building |

---

## Safety

1. Never commit API keys; never put keys in query strings.
2. Treat model output as untrusted until `ResponseValidator` passes.
3. Do not execute URLs from citations; display only.
4. Kids mode: verified-only; avoid graphic violence in prompts.
5. Refuse narration when `web_search_unavailable` rather than silently using parametric memory as “verified”.
6. English narrations only (prompt-enforced).

---

## Degraded client path (shipped)

```
Identify (OSM) → try Responses+web_search → on failure:
  status = web_search_unavailable
  claims.verified = []
  narration explains research unavailable (English)
  UI shows Worker recommendation from docs
```

No fabricated historical storytelling in this path.

---

## Honest GitHub Pages limits

- No shared cross-user cache until Worker + Supabase.
- Browser Responses + `web_search` may fail CORS — degraded path is intentional, not a bug.
- User-supplied keys in `localStorage` are demo-only; commercial product should use server-held keys.
