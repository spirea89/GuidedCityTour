# Cloudflare Worker (future)

This folder documents the **recommended** production proxy for GuidedCityTour. It is **not** deployed with the static GitHub Pages site.

## Why

- Reliable OpenAI **Responses API** + **`web_search`**
- Server-held API key (users need not paste keys for production)
- Shared KV cache across visitors
- Rate limiting and schema validation

## Suggested layout (when implemented)

```
workers/
  src/
    index.js          # fetch handler: POST /v1/tour
    openai.js         # Responses client
    cache.js          # KV helpers
    validate.js       # TourResponse rules
  wrangler.toml
  README.md           # this file
```

## Env secrets

- `OPENAI_API_KEY` — via `wrangler secret put`
- Optional: `SITE_TOKEN` for simple shared-secret auth from the Pages origin

## Minimal handler sketch

```js
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return corsPreflight();
    if (request.method !== "POST") return json({ error: "method" }, 405);

    const body = await request.json();
    const cacheKey = makeKey(body);
    const hit = await env.TOUR_CACHE.get(cacheKey, "json");
    if (hit) return cors(json({ ...hit, meta: { ...hit.meta, cached: true } }));

    const research = await openAiResponses(env.OPENAI_API_KEY, body);
    const tour = validateTour(research);
    if (tour.status === "ok") {
      await env.TOUR_CACHE.put(cacheKey, JSON.stringify(tour), {
        expirationTtl: 60 * 60 * 24 * 14,
      });
    }
    return cors(json(tour));
  },
};
```

## Client switch

Set `API.tourEndpoint` in `js/config.js` to the Worker URL. Keep user-key browser mode as a demo fallback.

## Do not

- Commit secrets
- Force-push
- Log raw API keys or full Authorization headers
