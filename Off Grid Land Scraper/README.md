# Off-Grid Land Scraper (Apify Actor)

An Apify Actor that scrapes [LandSearch](https://www.landsearch.com) land listings, normalizes the data, scores each listing for off-grid suitability, and outputs app-ready property cards for a swipe-based interface (e.g. Tinder-style).

## What it does

1. **Starts** from one or more LandSearch search or result URLs.
2. **Crawls** search pages and discovers listing detail page URLs.
3. **Visits** each listing page and extracts title, price, acres, location, image, description, tags, broker, and related fields.
4. **Normalizes** numbers (price, acres, price per acre), text, and state codes.
5. **Scores** each listing 0–100 for off-grid suitability and assigns a grade (A/B/C/D), with `whyItRanks`, `redFlags`, and `badges`.
6. **Filters** by your input options (states, acreage, price, off-grid tag, owner financing).
7. **Writes** clean, structured records to the Apify dataset, ready to push into your app database.

## Project structure

```
.
├── .actor/
│   ├── actor.json          # Actor metadata and config
│   └── input_schema.json   # Apify input schema and defaults
├── src/
│   └── main.js             # Crawler, extraction, scoring, output
├── Dockerfile              # Apify Actor runtime
├── package.json
└── README.md
```

## Run locally

Requirements: **Node.js 18+** (or 20).

```bash
# Install dependencies
npm install

# Run the actor (uses Apify SDK; will read input from Apify env or default)
npm start
```

To test with custom input locally, set `APIFY_INPUT_KEY_VALUE_STORE_ID` and put your input in the key-value store, or use Apify’s local dev flow. You can also temporarily hardcode an input object at the top of `src/main.js` and call the crawler (e.g. with a single LandSearch search URL and low `maxListings`).

## Deploy to Apify

1. Push this repo to GitHub.
2. In [Apify Console](https://console.apify.com) → **Actors** → **Create new** → **Import from Git**.
3. Connect your GitHub repo and select this project.
4. Apify will use `.actor/actor.json` and `.actor/input_schema.json`; ensure **Input** points to `./input_schema.json` in `actor.json` (it does by default).
5. Build and run the actor with your desired input.

The **Dockerfile** at the repo root is used for building the Actor image.

## Example input

```json
{
  "startUrls": [
    { "url": "https://www.landsearch.com/properties/United-States" },
    { "url": "https://www.landsearch.com/properties/filter/state=AZ,size[min]=2,size[max]=40/p1" }
  ],
  "maxListings": 50,
  "maxRequestsPerCrawl": 200,
  "includeStates": ["AZ", "NM", "TX"],
  "excludeStates": [],
  "minAcres": 2,
  "maxAcres": 40,
  "maxPrice": 150000,
  "requireOffGridTag": false,
  "requireOwnerFinancing": false
}
```

- **startUrls**: LandSearch search or listing index URLs.
- **maxListings**: Stop after this many detail pages.
- **maxRequestsPerCrawl**: Hard cap on total requests.
- **includeStates** / **excludeStates**: State filters (e.g. `["AZ","NM"]`).
- **minAcres** / **maxAcres** / **maxPrice**: Numeric filters; `0` means no limit.
- **requireOffGridTag** / **requireOwnerFinancing**: When `true`, only listings that mention off-grid or owner financing are output.

## Output format

Each dataset item is one listing, normalized and scored. Example:

```json
{
  "id": "a1b2c3d4e5f6g7h8",
  "headline": "5 Acres in Arizona",
  "subheadline": "$24,900 • 5 acres • Apache County",
  "score": 84,
  "grade": "A",
  "badges": ["off-grid", "owner-financing", "road-access"],
  "whyItRanks": [
    "Low price per acre",
    "Good acreage range (2–40 acres)",
    "Owner financing mentioned"
  ],
  "redFlags": [],
  "location": {
    "city": null,
    "county": "Apache County",
    "state": "AZ"
  },
  "metrics": {
    "price": 24900,
    "acres": 5,
    "pricePerAcre": 4980
  },
  "image": "https://...",
  "description": "...",
  "source": "LandSearch",
  "sourceUrl": "https://www.landsearch.com/properties/..."
}
```

- **id**: Stable 16-char id derived from the listing URL.
- **score**: 0–100 off-grid suitability.
- **grade**: A (80+), B (65+), C (50+), D (&lt;50).
- **badges**: Positive tags (e.g. off-grid, owner-financing, road-access, water).
- **whyItRanks** / **redFlags**: Short human-readable reasons for the score.

## Tech stack

- **JavaScript** (ES modules), Node 18+
- **Apify** SDK for Actor env, input, and dataset
- **Crawlee** with **CheerioCrawler** for fast HTML scraping
- Request labels: `SEARCH` (index pages) and `DETAIL` (listing pages)
- Deduplication and limits applied via `maxListings` and `maxRequestsPerCrawl`

## Next improvements

- **Webhook sync**: After a run, call a webhook to push dataset items to Supabase, Firebase, or your app API.
- **Second actor**: A separate “enrichment” actor that takes dataset output, adds geocoding or external data, and re-ranks or merges duplicates.
- **Scheduling**: Run the actor on a schedule (e.g. daily) via Apify’s scheduler and keep your app’s land feed fresh.
- **Browser fallback**: If LandSearch relies on client-side rendering on some pages, add a Puppetee/Playwright crawler for those URLs and keep Cheerio for the rest.
- **Geocoding and county scoring**: Geocode listings (e.g. from address or coordinates), then score by county-level off-grid friendliness (e.g. building codes, utilities, land use data).

---

License: Apache-2.0.
