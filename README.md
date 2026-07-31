# Guided City Tour (Map Explorer)

A static map app for exploring locations and generating **grounded** guided-tour stories. Built with Leaflet (desktop), optional MapLibre GL (mobile), OpenStreetMap / Nominatim, and OpenAI — no backend required for the demo path.

**Live site:** [https://spirea89.github.io/GuidedCityTour/](https://spirea89.github.io/GuidedCityTour/)

**On-page version:** look for **`v2.2.1`** in the header badge and side-panel footer. After a deploy, hard-refresh if the version does not match - GitHub Pages can serve a cached older build briefly.

## Architecture (v2.1+)

Hallucination-resistant AI layer: the LLM is a **narration/reasoning engine**, not the source of truth. Pipeline:

1. **Identify** place from OSM (confidence + confirmation if low) — `BuildingIdentifier`
2. **Research** via OpenAI **Responses API** + **web_search** when available
3. **Extract** verified / uncertain / legends / unknown claims with sources
4. **Narrate** only from verified facts (History, Architecture, Personalities, Today, Kids; legends clearly labeled)
5. **Validate** structured JSON before display; show **citations**; cache locally (Supabase designed for production)

Full design: **[docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md)**  
Also: [prompts](docs/ai/prompts.md) · [JSON schema](docs/ai/json-schema.md) · [implementation plan](docs/ai/implementation-plan.md) · [backend interfaces](docs/ai/backend-interfaces.md) · [Supabase cache](docs/ai/supabase-cache.md)

Client modules live under `js/services/` (`BuildingIdentifier` / `PlaceIdentifier`, `ResearchService`, `FactVerifier`, `NarrationGenerator`, `PromptBuilder`, `CacheService` / `TourCache`, `OpenAIService`, `ResponseValidator`, `TourPipeline`, `MobileMap`).

## Features

- Interactive Leaflet map with OpenStreetMap tiles (desktop / Mobile off)
- **Mobile** header switch: phone-friendly stacked layout, larger tap targets; preference in `localStorage` (`gct_mobile_fit`); auto-enables on narrow viewports when unset
- Mobile MapLibre GL map (OpenFreeMap, no API key): geolocation centering, ~60 degree pitch, optional device compass, 3D building extrusions when tile data allows
- Nearby landmark chips (~150 m) under the mobile map for tapping buildings/POIs next to you
- Fallback: if MapLibre fails to load, keep Leaflet 2D but still apply the mobile layout
- Nominatim place search and reverse geocoding
- Optional browser geolocation (“Use my location”)
- Side panel: Google Maps embed, coordinates, Street View / Maps links
- Story focus: landmark (stadium, museum, church, ...), house/building, street, or neighbourhood/area
- Topic toggles: History, Architecture, Personalities, Interesting facts, Today + **Kids mode**
- Grounded tour generation (Responses + web_search when the browser allows it)
- **Degraded path:** if web research is blocked (CORS / API), the app **refuses to invent history**
- IndexedDB cache for successful grounded tours (per browser); Supabase adapter stub for shared production cache
- **Listen** with Web Speech API TTS (English narrations)

## OpenAI API key (browser-only demo)

Stories need an [OpenAI API key](https://platform.openai.com/api-keys).

1. Open the live site (or serve this folder locally).
2. Paste your key in the **API key** dialog.
3. Choose **Quality (gpt-4o)** or **Economy (gpt-4o-mini)**.
4. Key and model are stored only in **`localStorage`**.
5. The key is sent **only to OpenAI** — never to GitHub Pages.

### Security notes

- **Do not commit API keys** to git or put them in the URL.
- Prefer a key with usage limits suitable for personal demos.
- Production should use a **Cloudflare Worker** (server-held key + Supabase shared cache) — see `docs/ai/backend-interfaces.md`, `docs/ai/supabase-cache.md`, and `workers/README.md`.

## How the pipeline works

1. Click the map or search → Nominatim fills address + nearby OSM allow-list.
2. Choose focus + topics (+ optional Kids mode).
3. **Generate grounded tour** runs `TourPipeline`:
   - Low identification confidence → confirm candidate (no research yet)
   - Research with web search when possible
   - Structured JSON validated; citations rendered when present
4. If Responses/`web_search` fails from the browser, you get `web_search_unavailable` — map identity only, **no fabricated history**.

## Mobile 3D notes

- Tiles/style: [OpenFreeMap](https://openfreemap.org/) Liberty + planet vector source (free, no key).
- Extrusions use OSM building heights when present (`render_height` / `height`). Coverage varies by city; where 3D data is thin, the pitched map plus nearby chips still let you pick places next to you.
- Compass uses `DeviceOrientationEvent` (may require a tap on **Compass** / iOS permission).
- Desktop with **Mobile** off keeps the original Leaflet flow unchanged.

## Deploy to GitHub Pages

1. Push to GitHub `main`.
2. **Settings → Pages** → Deploy from branch `main` / `(root)`.
3. Confirm live badge shows `v2.2.1` (hard-refresh if needed).

ES modules require `http://` or `https://` (not always `file://`). Serve locally with any static server if needed.

### CORS note

Chat Completions with a user key often works in the browser. **Responses API + web_search** may be blocked — the client degrades safely. A Worker proxy + Supabase is the production fix. IndexedDB alone does not share cache across visitors.

## Stack

- Leaflet + OpenStreetMap tiles + Nominatim
- MapLibre GL JS + OpenFreeMap (mobile mode, CDN)
- Vanilla JS ES modules (`js/`)
- OpenAI Responses API (+ web_search) with Chat Completions degraded path
- IndexedDB tour cache (+ Supabase adapter stub)
- Web Speech API for TTS
