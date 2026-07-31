# Implementation & refactoring plan

## Complete implementation plan

### Phase A — Contracts (done in v2.0.0)

1. Document architecture, prompts, schema, backend interfaces.
2. Define `Place` / POI model and `TourResponse` schema in code.
3. Define service interfaces (classes with clear public methods).

### Phase B — Client services (done in v2.0.0)

1. `CacheService` — IndexedDB, TTL, key builder, invalidate.
2. `OpenAIService` — Responses API (+ web_search tool) with Chat Completions fallback detection.
3. `PromptBuilder` — system / developer / user templates.
4. `PlaceIdentifier` — OSM fields → entity type + confidence + candidates.
5. `ResearchService` — grounded research or `web_search_unavailable`.
6. `FactVerifier` — normalize claim buckets; drop unverified “memory” claims in degraded mode.
7. `NarrationGenerator` — adult + kids from verified (+ labeled legends).
8. `ResponseValidator` — structural + application rules.
9. `TourPipeline` — orchestrate identify → research → verify → narrate → validate → cache.
10. `storyRenderer` — status banners, sections, citations, confirmation UI.

### Phase C — UI wiring (done in v2.0.0)

1. Category toggles: History, Architecture, Famous people, Interesting facts, Today, Kids mode.
2. Replace Chat Completions free-text story path with `TourPipeline.run`.
3. Keep geolocation, Nominatim, nearby allow-list, TTS, API key modal.
4. Bump `APP_VERSION` to `v2.0.0`.

### Phase D — Backend (deferred)

1. Cloudflare Worker proxy for Responses + `web_search`.
2. Shared KV cache; rate limits; optional server key.
3. Point client `OpenAIService` base URL at Worker when configured.
4. Server-side schema validation + logging (no PII beyond place coords).

---

## Step-by-step refactoring plan (executed)

1. **Freeze behavior expectations** — map click / search / focus / TTS remain; story quality rules change to anti-hallucination.
2. **Extract config** — version, storage keys, nearby constants, confidence thresholds → `js/config.js`.
3. **Introduce models + schema** — no UI change yet.
4. **Implement services behind `TourPipeline`** — unit-testable pure-ish modules.
5. **Swap `generateStory()`** for `pipeline.run()` in `app.js`.
6. **Add category UI + citations + confirmation** — progressive enhancement of panel.
7. **Degraded path** — if Responses/CORS fails, show `web_search_unavailable` and refuse fabrication.
8. **Docs + README** — architecture pointer, how to verify live version badge.
9. **Commit & deploy** — push `main` for GitHub Pages.

---

## Testing checklist

- [ ] No API key → modal; Generate disabled.
- [ ] Pin + focus → Generate runs pipeline.
- [ ] Low-confidence / ambiguous → confirmation candidates, no invented history.
- [ ] With working Responses + web_search → verified claims + citations.
- [ ] When web_search blocked → clear error; no fake dates/people.
- [ ] Kids mode → simpler text; no legends-as-fact.
- [ ] TTS reads rendered adult (or kids) narration.
- [ ] Version badge shows `v2.0.0`.
- [ ] Cache hit on second identical request (same pin/focus/categories).

---

## What stays client-side vs moves server-side

| Capability | Client now | Must move / add server later |
|------------|------------|------------------------------|
| OSM identify + nearby | Yes | Optional enrich |
| User API key | Yes | Optional BYOK; prefer server key |
| IndexedDB cache | Yes | Shared KV |
| Responses + web_search | Attempt | **Worker proxy** (CORS / reliability) |
| Schema validation | Yes | Duplicate on server |
| Rate limiting | Soft (user key) | Hard limits on Worker |
| Audit / abuse | No | Yes |
