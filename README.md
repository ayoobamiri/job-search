# IT Job Search Dashboard

A personal dashboard for finding current Information Technology / Technology
Specialist job openings in **Sacramento, Yolo, Placer, and El Dorado
Counties**, aggregated from configurable government and education job
boards. Static frontend + a scheduled scraper, no server required.

## How it works

```
index.html, css/, js/     Static dashboard (reads data/jobs.json)
data/
  jobs.json                Scraper output: the current active job list
  sources.json              Editable list of job-search websites
  counties.json              Editable list of target counties
  keywords.json               IT job-title keywords used to filter listings
  city-county-map.json         Maps a city name to one of the counties above
scraper/
  scrape.js                  Entry point: run with `npm run scrape`
  adapters/{neogov,edjoin}.js  One module per job-board platform
  lib/                        Fetching, JSON-LD parsing, filtering, geocoding, dedupe
.github/workflows/scrape-jobs.yml   Runs the scraper every 4 hours and commits data/jobs.json
```

The dashboard itself is just static HTML/CSS/JS — it never talks to the
external job sites directly (the browser would be blocked by CORS, and
scraping shouldn't run on every visitor's machine anyway). Instead:

1. `scraper/scrape.js` runs elsewhere with real internet access — on a
   schedule via the included GitHub Actions workflow, or manually with
   `npm run scrape` from `scraper/`.
2. It fetches each **enabled** source in `data/sources.json`, keeps only
   postings whose title matches `data/keywords.json`, resolves each
   posting's county from `data/city-county-map.json` and drops anything
   outside `data/counties.json`, drops anything past its closing date,
   de-duplicates postings that appear on more than one source, and (if
   `HOME_LAT`/`HOME_LON` are set) computes distance from home.
3. It writes the result to `data/jobs.json`, which the static dashboard
   reads on load and on "Refresh Jobs".

**Nothing is invented.** If a source doesn't provide a salary, closing
date, or employment type, the dashboard shows "Not provided" rather than
guessing. A posting with no closing date is labeled "No closing date
provided," never assumed to be open forever. Expired postings are dropped
automatically on every scrape run.

## Setting up your home location (for distance)

Distance is computed two ways, and never by publishing your address:

- **Default (repo-wide):** add `HOME_LAT` and `HOME_LON` as GitHub Actions
  repo secrets (Settings → Secrets and variables → Actions). The scraper
  uses them only in memory during the run to compute each job's distance;
  the coordinates themselves are never written to `jobs.json` or the repo.
- **Personal override (this browser only):** open **My Job Search** on the
  dashboard and enter your coordinates under "Home Location." That value
  is saved only in your browser's `localStorage` and recomputes distance
  client-side using each job's already-public city coordinates — it's
  never uploaded anywhere.

## Managing search sources

Go to **Search Sources** on the dashboard to add, edit, remove, or
enable/disable a source. Two adapter types are supported out of the box:

- `neogov` — any [governmentjobs.com](https://www.governmentjobs.com) or
  [schooljobs.com](https://www.schooljobs.com) career site (these run the
  same NEOGOV platform, so this covers most CA city/county/school agencies).
- `edjoin` — [edjoin.org](https://www.edjoin.org).

Changes made in the UI are saved to your browser only. To change what the
**scheduled scraper** actually searches (i.e. what ends up in the shared
`jobs.json` everyone sees), click **Export Config**, then commit the
downloaded `sources.json` over `data/sources.json`.

Adding a source with an unsupported platform isn't possible from the UI
alone — a new adapter module would need to be written for that platform's
markup (see `scraper/adapters/neogov.js` for the pattern).

## Running the scraper locally

```bash
cd scraper
npm install
HOME_LAT=38.58 HOME_LON=-121.49 npm run scrape   # HOME_LAT/LON optional
```

This overwrites `data/jobs.json`. Open `index.html` with any static file
server (e.g. `python3 -m http.server`) to view it.

## Known limitations / what to verify once deployed

This was built in a sandboxed environment whose network policy blocks
outbound requests to governmentjobs.com, schooljobs.com, and edjoin.org, so
the scraper's HTML-parsing logic could not be tested against live pages.
It's built defensively:

- Each adapter's **primary** parsing strategy reads
  [schema.org `JobPosting` JSON-LD](https://schema.org/JobPosting), which
  government/education job boards generally publish so listings show up in
  Google for Jobs — this is far more stable than guessing CSS selectors.
- A DOM-scraping fallback runs if a detail page has no JSON-LD.
- Listing-page **link discovery** (finding which URLs are job postings) is
  the part most likely to need adjustment, since it relies on guessed URL
  patterns. If a scrape run finds 0 jobs for an enabled source, check
  `sourceRunSummary` in `data/jobs.json` first — an `"error"` status means
  the listing page itself couldn't be loaded; an `"ok"` status with
  `jobsFound: 0` means the page loaded but no job links matched the
  patterns in `scraper/adapters/*.js`, which is the place to fix.
- EDJOIN's search results may render via client-side JavaScript that a
  plain HTML fetch can't execute — if so, `scraper/adapters/edjoin.js`
  needs to be pointed at EDJOIN's underlying JSON search API instead.

Run `npm run scrape` locally (from an environment with normal internet
access) after first deploying this to confirm each source returns results,
and adjust the relevant adapter if one comes back empty.

## Deploying the dashboard

This is a static site (no build step), so it can be hosted as-is on GitHub
Pages: repo Settings → Pages → deploy from the `main` branch, root folder.
