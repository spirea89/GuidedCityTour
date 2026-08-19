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

An OpenAI API key is required to rank notable buildings and to generate stories. It is stored in the Keychain.

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
