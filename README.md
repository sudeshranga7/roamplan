# RoamPlan

Tell RoamPlan where you're going, when, and for how long. It builds three itineraries (relaxed, balanced, packed) from real places, with weather and a "popular right now" list. No AI and no API keys: everything comes from free, open data.

By default it loads a Goa weekend for a 16-person office group (beaches, cafés, clubs, watersports).

## Features

- Multiple places per trip, with days split across them
- Three paces: relaxed, balanced, packed
- Day-by-day timeline with real venues, map links and websites
- Weather forecast, or last year's weather for the same dates when the trip is far off
- Group tips based on party size
- Download as PDF (browser print dialog, "Save as PDF")
- Responsive, with dark mode

## How it works

| Need | Source |
| --- | --- |
| Places (beaches, cafés, clubs, sights...) | OpenStreetMap via Nominatim and Overpass |
| Destination intro | Wikivoyage, falling back to Wikipedia |
| Popular right now | Wikipedia pageviews (last 30 days) |
| Weather | Open-Meteo (called from the browser) |

The planner ([planner.js](planner.js)) is rule-based. It turns your interests into place categories, ranks places by how well documented they are, and fills a time template for each pace. Each pick favours places close to the previous stop. "Popular" is a proxy, not true trend data, and OpenStreetMap coverage varies by region.

## Stack

- Frontend: React 19 + Vite ([src/](src/))
- Backend: dependency-free Node server ([server.js](server.js), [planner.js](planner.js)) that serves the API and the built site

## Run locally

Needs Node 18+.

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

For development with hot reload, run these in two terminals and open http://localhost:5173:

```bash
npm run dev:api    # API on :3000
npm run dev        # Vite on :5173, proxies /api to :3000
```

## Deploy on Render (free)

1. Push this repo to GitHub.
2. In Render, choose New, then Blueprint, and select the repo. [render.yaml](render.yaml) configures the rest.
3. Share the `onrender.com` URL.

Notes for the free tier:

- The service sleeps after about 15 minutes idle, so the first visit can take around 50 seconds.
- The disk is wiped on restart. The Goa default is pre-cached in [.cache/](.cache/) and ships with the repo, so it loads quickly.
- The first search for any other place can take up to a minute while the public OpenStreetMap servers respond. Results are then cached for 7 days. If those servers fail, older cached data is used.

## Project layout

```
server.js       HTTP server: /api/itinerary + static files from dist/
planner.js      Data fetching, caching, ranking and scheduling
src/            React app (components, styles, weather helper)
.cache/         Cached API responses (Goa pre-warmed)
render.yaml     Render blueprint
```

## API

`POST /api/itinerary`

```json
{
  "places": ["Goa"],
  "startDate": "2026-10-30",
  "days": 3,
  "travellers": 16,
  "interests": "beaches, cafés, clubs, watersports"
}
```

Returns `destination`, `summary`, `trends`, `groupTips` and `plans` (`relaxed`, `mid`, `hectic`), each with `days` and `slots`.

## Limitations

- Opening hours and prices are not guaranteed; check before you go.
- Sparse OpenStreetMap areas produce thinner plans, and very small places may return an error.
- Interests are matched by keyword (beach, cafe, club, watersports, sights, nature, shopping, food).

## Credits

Place data © OpenStreetMap contributors (ODbL). Text from Wikivoyage and Wikipedia (CC BY-SA). Weather by Open-Meteo.
