# RoamPlan

Tell RoamPlan where you're going, when, and for how long. It builds three itineraries (relaxed, balanced, packed) from real places, with weather and a "popular right now" list. No AI and no API keys: everything comes from free, open data.

The landing page starts empty, with greyed-out examples in each field and six ready-made trip ideas to tap.

## Features

**Planning**
- Multiple places per trip, with days split across them
- Three paces: relaxed, balanced, packed
- Stops are scheduled around OpenStreetMap opening hours where they're known
- Weather-aware: on days with a high chance of rain, indoor places come first (forecast window only)
- Vegetarian-friendly and wheelchair-access preferences, from checkboxes or words in the interests box
- The sunset stop follows your interests: a beach for beach lovers, otherwise a viewpoint or park
- Group tips based on party size

**Using a plan**
- Day-by-day timeline with real venues, map links, websites, and walking or driving time between stops
- Map of each day's stops (Leaflet + OpenStreetMap tiles, loaded only when opened)
- Edit a day: swap a stop for a nearby alternative, move stops earlier or later, or remove them
- Share link: the URL holds the trip and any edits, so friends see the same plan
- Add to calendar (.ics), and download as PDF (browser print dialog, "Save as PDF")
- Works offline for trips you've opened before, and can be installed to a phone's home screen
- Live progress while a plan is built

## How it works

| Need | Source |
| --- | --- |
| Places (beaches, cafés, clubs, sights...) | OpenStreetMap via Nominatim (topped up from Overpass when results are thin) |
| Destination intro | Wikivoyage, falling back to Wikipedia |
| Popular right now | Wikipedia pageviews (last 30 days) |
| Weather | Open-Meteo (cards in the browser; rain check on the server) |

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

- The service normally sleeps after about 15 minutes idle. On Render the server pings its own `/healthz` every 10 minutes (using `RENDER_EXTERNAL_URL`) to stay awake. Set `KEEP_AWAKE=0` to turn this off. One always-on service uses about 744 of the 750 free instance hours a month, so don't run a second free service alongside it.
- After a deploy or restart, the first visit can still take around 50 seconds.
- The disk is wiped on restart, so `.cache/` doesn't survive. About 30 popular destinations are pre-fetched into [.seed/](.seed/), which is committed, so they plan instantly. Refresh them every few months with `npm run seed` (15 to 30 minutes), or seed one place with `npm run seed -- "Lisbon"`.
- The first search for any other place usually takes 20 to 45 seconds, because Nominatim allows one request per second. Results are then cached for 7 days, and older cached data is used if the servers fail.
- Each IP address can request 30 plans per 10 minutes, to protect the free data services.

## Project layout

```
server.js       HTTP server: /api/itinerary (streams progress) + static files from dist/
planner.js      Data fetching, caching, opening hours, ranking and scheduling
src/            React app (components, styles, share links, calendar export)
public/         Service worker, web app manifest, icon
scripts/seed.js Pre-fetches popular destinations into .seed/
tests/          Vitest tests (`npm test`)
.seed/          Committed pre-fetched data; .cache/ is the runtime cache (not committed)
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
  "interests": "beaches, cafés, clubs, watersports",
  "prefs": ["veg"]
}
```

`prefs` is optional: any of `"veg"` and `"wheelchair"`.

Returns `destination`, `summary`, `trends`, `groupTips` and `plans` (`relaxed`, `mid`, `hectic`), each with `days` and `slots`. Slots include coordinates and up to two `alts`, and rainy days carry a `note`. Send `Accept: application/x-ndjson` to get `{"progress": "..."}` lines first, then `{"result": ...}`.

## Limitations

- Opening hours and prices are not guaranteed; check before you go. Unusual opening-hours formats (public holidays, sunrise/sunset) are treated as unknown, so those places count as open.
- Travel times are estimates from straight-line distance, not real routes.
- Sparse OpenStreetMap areas produce thinner plans, and very small places may return an error.
- Names appear as "English (local)" when OpenStreetMap has an English name, and in the local language otherwise.
- Interests are matched by keyword (beach, cafe, club, watersports, sights, nature, shopping, food).

## Credits

Place data © OpenStreetMap contributors (ODbL). Text from Wikivoyage and Wikipedia (CC BY-SA). Weather by Open-Meteo.
