# City Quest (iOS)

Native SwiftUI + SceneKit app that turns the Guided City Tour pipeline into a location game.

The web app stays as-is. This project **does not replace** the GitHub Pages site — it is a companion iOS client with a stylized 3D district instead of a photoreal map.

## What it does

1. **Pick an area** on a MapKit map (your GPS location, search, or pan the crosshair).
2. **Gamify** that radius: OpenStreetMap building footprints become a low-poly quest district (SceneKit). Landmarks get brighter colors, churches get a spire, named places get floating labels.
3. **Tap a building** to open sourced history through the same identify → research → narrate contract as the web app (OpenAI Responses + `web_search` when available; otherwise it refuses to invent history).

Buildings are **sketches**, not copies of the real facade.

## Open in Xcode

Requires **Xcode 15.4+** (iOS 17 SDK) on a Mac.

1. Open `ios/GuidedCityTour.xcodeproj`.
2. Select the **GuidedCityTour** scheme.
3. Signing & Capabilities → choose your **Team** (bundle id `com.guidedcitytour.ios`).
4. Run on an iPhone / iPad, or the Simulator.

### Simulator location

**Features → Location → Custom Location** (or Apple’s city presets). The map will center on that coordinate so you can gamify a real neighbourhood without leaving your desk.

### Device

Grant **While Using the App** location access. History needs an OpenAI API key (Settings or onboarding). The key is stored in the Keychain and sent only to OpenAI.

## Architecture (mirrors the web pipeline)

| iOS | Web |
|---|---|
| `OverpassService` | `LandmarkFinder` + building footprints |
| `GeocoderService` (Photon) | `Geocoder.js` |
| `TourPipeline` | `TourPipeline.js` |
| `OpenAIClient` | `OpenAIService.js` |
| `TourCache` (on-device files) | IndexedDB cache |
| SceneKit quest district | MapLibre 3D extrusions |

Identity still comes from OSM. Verified claims still require sources.

## Project layout

```
ios/
  GuidedCityTour.xcodeproj
  GuidedCityTour/
    GuidedCityTourApp.swift
    Theme.swift
    Models/
    Services/
    Views/
      MapPickerView.swift      # choose area + radius
      GameWorldView.swift      # 3D district
      QuestSceneView.swift     # SceneKit
      BuildingHistoryView.swift
```
