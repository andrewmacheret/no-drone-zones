# No-Drone Zones

[![Test and deploy](https://github.com/andrewmacheret/no-drone-zones/actions/workflows/deploy.yml/badge.svg)](https://github.com/andrewmacheret/no-drone-zones/actions/workflows/deploy.yml) [![Canary](https://github.com/andrewmacheret/no-drone-zones/actions/workflows/canary.yml/badge.svg)](https://github.com/andrewmacheret/no-drone-zones/actions/workflows/canary.yml) [![License](https://img.shields.io/badge/license-MIT-lightgray.svg)](https://github.com/andrewmacheret/no-drone-zones/blob/master/LICENSE.md)

Shows the no-drone zones near your current location, on a map and as a list sorted by distance. The zones come from the FAA and National Park Service and update daily.

Live at [andrewmacheret.com/projects/no-drone-zones](https://andrewmacheret.com/projects/no-drone-zones/).

![Screenshot of No-Drone Zones near Seattle](www/screenshot.jpg)

## Usage

Open the page and allow location access. It shows four kinds of zones in the US:

- Airport airspace (red): controlled airspace that starts at the ground. Drones need FAA permission ([LAANC](https://www.faa.gov/uas/getting_started/laanc)) to fly here.
- National security (green): FAA national security flight restrictions, like military bases. No drones below 400 feet.
- Prohibited areas (purple): no aircraft at all, like the White House and Camp David.
- National parks (blue): the National Park Service bans drones in its parks.

The list shows every zone within the distance you pick (up to 200 km or 124 mi), in kilometers or miles. Orange entries are how far away a zone is. Red entries mean you're inside it, with the distance to its edge. Click a name to show it on the map.

Without location access, you can still move the map around. Zones show up once you zoom in far enough.

## How it works

- `www/` is the web page. It uses [Leaflet](https://leafletjs.com/) with [OpenStreetMap](https://www.openstreetmap.org/) tiles for the map, and [Turf.js](https://turfjs.org/) for the distance math. It asks the API for the zones near you and in the map view as you move around.
- `src/lambda/` is a Python AWS Lambda called `NoDroneZones`, behind API Gateway at `no-drone-zones.andrewmacheret.com`.
  - `GET /zones?bbox=west,south,east,north` returns the zones in a box (up to 10 degrees each way) as GeoJSON.
  - When called with `{"refresh": true}`, it downloads the zones from these sources with `zones.py`, simplifies the shapes to about 50 meters, and saves them in a SQLite file in the private S3 bucket `andrewmacheret-no-drone-zones`. It skips the rebuild if no source has changed, unless `"force": true` is passed. An EventBridge rule sends this once a day.
    - [FAA Class Airspace](https://adds-faa.opendata.arcgis.com/datasets/c6a62360338e408cb1512366ad61559e_0)
    - [FAA National Security UAS Flight Restrictions](https://udds-faa.opendata.arcgis.com/datasets/0270b9d8a5d34217856cc03aaf833309_0)
    - [FAA Prohibited Areas](https://adds-faa.opendata.arcgis.com/datasets/faa::prohibited-areas/about)
    - [National Park Service Boundaries](https://irma.nps.gov/DataStore/Reference/Profile/2321443)
  - API requests download that SQLite file to `/tmp` and check S3 for a newer copy every 10 minutes.

This is for fun, not flight planning. Check the FAA's [B4UFLY](https://www.faa.gov/uas/getting_started/b4ufly) before you fly, since it also covers temporary flight restrictions.

## Development

Run tests with `cd src/lambda && python3 -m unittest` (needs Python 3.14). Two tests call the real FAA servers.

To try the page locally:

```
python3 -m http.server -d www
```

Then open [http://localhost:8000](http://localhost:8000). Browsers allow location access on `localhost`, so this works without HTTPS. Add `?api=<your API URL>` to use a different API.

## Health check

[`/projects/no-drone-zones/healthcheck/`](https://andrewmacheret.com/projects/no-drone-zones/healthcheck/) checks the page and its scripts and styles (including Leaflet and Turf), OpenStreetMap's tiles, and the API's `/healthcheck`, which fails if the daily FAA and NPS refresh failed or didn't run. The Canary workflow (`.github/workflows/canary.yml`) opens it once a day, started by [andrewmacheret/canary](https://github.com/andrewmacheret/canary).

## Deploy

Pushes to `master` run the tests, then GitHub Actions deploys the Lambda, refreshes the zones, and uploads `www/` to `s3://andrewmacheret.com/projects/no-drone-zones` (see `.github/workflows/deploy.yml`). To redeploy without a code change, use "Run workflow" on the Actions tab.

The workflow signs in to AWS with GitHub OIDC using the IAM role in the `AWS_ROLE_ARN` repo variable.

`www/screenshot.jpg` is used for this README and for link previews (`og:image`).
