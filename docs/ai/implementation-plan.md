# Implementation & refactoring plan

## Complete implementation plan

### Phase A — Contracts (done in v2.0.0; refreshed v2.1.0)

1. Document architecture, prompts, schema, backend interfaces, **Supabase cache**.
2. Define `Place` / POI model and `TourResponse` schema in code.
3. Define service interfaces (classes with clear public methods + SOLID aliases).

### Phase B — Client services (done in v2.0.0; evolved v2.1.0)

1. `TourCache` / `IndexedDBCache` / `SupabaseCache` stub / `CompositeCache` / `CacheService` alias.
2. `OpenAIService` — Responses API (+ web_search tool) with Chat Completions fallback.
3. `PromptBuilder` — system / developer / user templates; English + category sections.
4. `BuildingIdentifier` (= `PlaceIdentifier`) — OSM → entity type + confidence + candidates.
5. `ResearchService` — grounded research or `web_search_unavailable`.
6. `FactVerifier` — claim buckets; strip memory “verified” in degraded mode.
7. `NarrationGenerator` — adult + kids + sections from verified (+ labeled legends).
8. `ResponseValidator` — structural + app rules; `verifiedFacts` / `personalities` aliases.
9. `TourPipeline` — identify → research → verify → narrate → validate → cache.
10. `storyRenderer` — status banners, sections (Personalities), citations, confirmation.

### Phase C — UI wiring (done in v2.0.x)

1. Category toggles: History, Architecture, Personalities, Interesting facts, Today, Kids mode.
2. Replace free-text story path with `TourPipeline.run`.
3. Keep geolocation, Nominatim, nearby allow-list, TTS, API key modal.
4. Version badge → **v2.1.0**.

### Phase D — Backend (deferred — next production work)

1. Cloudflare Worker proxy for Responses + `web_search`.
2. Supabase `place_research` table; Worker upserts verified payloads.
3. Point client `API.tourEndpoint` at Worker; keep BYOK demo path.
4. Server-side schema validation + rate limits + audit (coords + name only).
5. Optional own curated DB seeded into cache for flagship cities.

---

## Step-by-step refactoring plan

### Already executed (v2.0 → v2.1)

1. Freeze UX: map click / search / focus / TTS; anti-hallucination story rules.
2. Extract config — version, storage keys, nearby constants, confidence, SUPABASE hooks.
3. Models + schema + services behind `TourPipeline`.
4. Swap `generateStory()` for `pipeline.run()`.
5. Category UI + citations + confirmation.
6. Degraded path refuses fabrication when web_search blocked.
7. Docs master + appendices; **Supabase** design; cache adapters.
8. Alias alignment: `BuildingIdentifier`, `verifiedFacts`, Personalities label.
9. Ship **v2.1.0** to `main` (GitHub Pages).

### Remaining (production)

1. Provision Supabase; run SQL in [supabase-cache.md](./supabase-cache.md).
2. Implement Worker `POST /v1/tour` with OpenAI secret + service-role writes.
3. Set `API.tourEndpoint` in deploy config (not committed secrets).
4. Add Worker rate limit + schema validation duplicate.
5. Cron purge expired `place_research` rows.
6. Map Wikidata/OSM ids → stable `place_id` cache keys.
7. Optional: claims-only cache + cheap narration regenerate for category variants.

---

## Testing checklist

- [ ] No API key → modal; Generate disabled.
- [ ] Pin + focus → Generate runs pipeline.
- [ ] Low-confidence / ambiguous → confirmation candidates, no invented history.
- [ ] With working Responses + web_search → verified claims + citations.
- [ ] When web_search blocked → clear error; no fake dates/people.
- [ ] Kids mode → simpler English text; no legends-as-fact.
- [ ] Sections: History / Architecture / Personalities / Today omit when empty.
- [ ] TTS reads English narration.
- [ ] Version badge shows `v2.1.0`.
- [ ] Cache hit on second identical request (same pin/focus/categories) via IndexedDB.
- [ ] `SupabaseCache` remains inert with empty config (no secrets required).

---

## What stays client-side vs moves server-side

| Capability | Client now | Must move / add server later |
|------------|------------|------------------------------|
| OSM identify + nearby | Yes | Optional enrich |
| User API key | Yes | Optional BYOK; prefer server key |
| IndexedDB cache | Yes | Supabase shared via Worker |
| Responses + web_search | Attempt | **Worker proxy** (CORS / reliability) |
| Schema validation | Yes | Duplicate on server |
| Rate limiting | Soft (user key) | Hard limits on Worker |
| Audit / abuse | No | Yes |
