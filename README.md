# Map Explorer (GuidedCityTour)

A simple single-page map app for exploring locations with Leaflet, OpenStreetMap, and Google Maps links. Click the map or search a place to preview it in an embedded Google Map and open Street View or Google Maps in a new tab. No API keys required.

## Features

- Interactive Leaflet map with OpenStreetMap tiles
- Nominatim place search (free, no API key)
- Side panel with Google Maps embed, coordinates, Street View, and Google Maps links
- Mobile-responsive layout (panel stacks under the map on narrow screens)

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Open the repo on GitHub → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose branch **main** (or **master**) and folder **/ (root)**.
5. Click **Save**. Your site will be available at `https://<username>.github.io/<repo-name>/` after a minute or two.

## Local use

Open `index.html` in a browser, or serve the folder with any static file server. Nominatim search needs a network connection and works best when the page is served over `http://` or `https://` (not always from `file://`).
