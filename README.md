# Guided City Tour (Map Explorer)

A static single-page map app for exploring locations and generating short guided-tour stories with ChatGPT. Built with Leaflet, OpenStreetMap / Nominatim, and the OpenAI API — no backend required.

**Live site:** [https://spirea89.github.io/GuidedCityTour/](https://spirea89.github.io/GuidedCityTour/)

**On-page version:** look for `v1.5.0` in the header badge and side-panel footer (`GuidedCityTour v1.5.0 · …`). After a deploy, hard-refresh if the version does not match the latest commit notes — GitHub Pages can serve a cached older build briefly.

## Features

- Interactive Leaflet map with OpenStreetMap tiles
- Nominatim place search and reverse geocoding (free, no API key)
- Optional browser geolocation (“Use my location”) with a distinct “you are here” marker
- Side panel: Google Maps embed, coordinates, Street View / Maps links
- Choose story focus: house/building, street, or neighbourhood/area
- Generate a vivid guided-tour story via OpenAI (`gpt-4o` by default; optional `gpt-4o-mini` economy) using **your** API key
- **Listen** to the story with browser text-to-speech (Web Speech API) — Listen / Pause / Stop; no extra TTS key required
- Mobile-responsive layout (panel stacks under the map on narrow screens)

## OpenAI API key (browser-only)

Stories need an [OpenAI API key](https://platform.openai.com/api-keys).

1. Open the live site (or local `index.html`).
2. Paste your key in the **API key** dialog (also available anytime from the header).
3. Choose **Quality (gpt-4o)** (default) or **Economy (gpt-4o-mini)** for cheaper/faster stories.
4. The key and model choice are stored only in **`localStorage`** in your browser.
5. The key is sent **only to OpenAI** when you click **Generate story** — never to this GitHub Pages site.

You can update or clear the key anytime. Without a key, **Generate story** stays disabled.

### Security notes

- **Do not commit API keys** to git, put them in the URL, or share screenshots that show the key.
- This is a static site: the key lives in the user’s browser. Anyone with access to that browser profile can read `localStorage`.
- Prefer a key with usage limits suitable for personal demos.

## Geolocation & story focus

- On load, the app may ask for your location (permission can be denied safely). Use **Use my location** anytime.
- Click the map or pick a search result → Nominatim reverse-geocode fills address details.
- In the side panel, choose **This house / building**, **This street**, or **This neighbourhood / area**, then **Generate story**.

## Story narration (text-to-speech)

After a story appears, use **Listen** to hear a cleaned reading via the browser’s built-in `speechSynthesis` voices (no ElevenLabs/OpenAI TTS required). **Pause** / **Resume** work when the browser supports them; **Stop** always cancels narration. Speech stops automatically when you clear the selection, change focus, or generate a new story. The app does **not** auto-play — browsers often block that without a user gesture.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Open the repo on GitHub → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose branch **main** and folder **/ (root)**.
5. Click **Save**. The site appears at `https://<username>.github.io/<repo-name>/` after a minute or two.

Bump the `APP_VERSION` constant in `index.html` with each meaningful release so the live header/footer version confirms you have the latest deploy.

## Local use

Open `index.html` in a browser, or serve the folder with any static file server. Nominatim and OpenAI need a network connection; geolocation and some APIs work best over `http://` or `https://` (not always from `file://`).

### CORS note

OpenAI’s Chat Completions API generally allows browser requests with a user-supplied key. If a call fails with a network/CORS error in your environment, a same-origin proxy would be needed — this project intentionally has **no backend**.

## Stack

- Leaflet + OpenStreetMap tiles
- Nominatim (search + reverse)
- OpenAI Chat Completions (`gpt-4o` / optional `gpt-4o-mini`) from the client
- Web Speech API (`speechSynthesis`) for optional story narration
