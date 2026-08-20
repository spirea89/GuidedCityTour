# City Quest (iOS)

Native SwiftUI companion to Guided City Tour. The web app stays as-is.

## What it does

1. **Pick an area** on the map (GPS, search, or pan the crosshair) and set a radius.
2. **Find notable places** — OpenAI (with web search when available) picks a short list of the most important buildings and monuments. Pins are placed with Photon geocoding, not a full building dump from Overpass.
3. **Tap a pin** to start that place’s sourced history (identify → research → narrate).

## Open in Xcode

Requires **Xcode 15.4+** (iOS 17 SDK) on a Mac.

1. Open `ios/GuidedCityTour.xcodeproj`.
2. Select the **GuidedCityTour** scheme.
3. Signing & Capabilities → choose your **Team** (bundle id `com.guidedcitytour.ios`).
4. Run on an iPhone / iPad, or the Simulator.

An OpenAI API key **or** a local LM Studio / Bionic server is required to rank notable buildings and generate stories.

### Local AI (LM Studio Bionic + Gemma)

1. In **LM Studio** (or Bionic’s shared LM Studio runtime): load Gemma 4 and open **Developer → Start Server**.
2. Default endpoint: `http://127.0.0.1:1234/v1`.
3. In the iOS app: **Settings → AI provider → Local**.
4. Paste the **exact model id** shown in LM Studio.
5. **Simulator:** `127.0.0.1` works. **Physical iPhone:** use your Mac’s LAN IP (e.g. `http://192.168.1.20:1234/v1`) and enable **Serve on Local Network** in LM Studio.

Local mode has no live web search — stories use the model’s knowledge with city-location checks. Listen falls back to on-device speech.

### Shared story cache (Supabase)

Stories and map pins are saved to Supabase project **`ifoybmzofjdgekvvrsot`** so repeat visits skip OpenAI. The publishable client key is built into the app — users do not configure Supabase.

Run the SQL in [`../supabase/migrations/`](../supabase/migrations/) once in the Supabase SQL Editor if you have not already.

### Simulator location

**Features → Location → Custom Location** (or a city preset).

## Architecture

| iOS | Web |
|---|---|
| `LandmarkDiscoveryService` | OpenAI ranks notable places in the chosen area |
| `GeocoderService` (Photon) | `Geocoder.js` |
| `TourPipeline` | `TourPipeline.js` |
| `OpenAIClient` | `OpenAIService.js` |
| `TourCache` + `SupabaseCacheService` | IndexedDB + Supabase `place_research` / `area_locations` |

History still requires sources. The pin list is a short, curated set — not every OSM building.
