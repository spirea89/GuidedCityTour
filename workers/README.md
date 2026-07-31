# Cloudflare Worker (future)

This folder documents the **recommended** production proxy for GuidedCityTour. It is **not** deployed with the static GitHub Pages site.

## Why

- Reliable OpenAI **Responses API** + **`web_search`**
- Server-held API key (users need not paste keys for production)
- Shared **Supabase** (or KV) cache across visitors — research once per building
- Rate limiting and schema validation

See [docs/ai/supabase-cache.md](../docs/ai/supabase-cache.md) and [docs/ai/backend-interfaces.md](../docs/ai/backend-interfaces.md).

## Suggested layout (when implemented)

```
workers/
  src/
    index.js          # fetch handler: POST /v1/tour
    openai.js         # Responses client
    cache.js          # Supabase / KV helpers
    validate.js       # TourResponse rules
  wrangler.toml
  README.md           # this file
```

## Env secrets

- `OPENAI_API_KEY` — via `wrangler secret put`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — cache writes
- Optional: `SITE_TOKEN` for simple shared-secret auth from the Pages origin

**Never commit secrets.**

## Minimal handler sketch

```js
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return corsPreflight();
    if (request.method !== "POST") return json({ error: "method" }, 405);

    const body = await request.json();
    const cacheKey = makeKey(body);
    const hit = await supabaseGet(env, cacheKey);
    if (hit) return cors(json({ ...hit, meta: { ...hit.meta, cached: true } }));

    const research = await openAiResponses(env.OPENAI_API_KEY, body);
    const tour = validateTour(research);
    if (tour.status === "ok" && tour.claims?.verified?.length) {
      await supabaseUpsert(env, cacheKey, tour, { ttlDays: 14 });
    }
    return cors(json(tour));
  },
};
```

## Client switch

Set `API.tourEndpoint` in `js/config.js` (or inject at deploy time) to the Worker URL. Keep user-key browser mode as a demo fallback. IndexedDB remains a local L1 cache.

## Do not

- Commit secrets
- Force-push
- Log raw API keys or full Authorization headers
- Treat model memory as verified when web_search fails
