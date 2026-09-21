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
npx playwright install chromium   # one-time browser download, needed for listing pages
HOME_LAT=38.58 HOME_LON=-121.49 npm run scrape   # HOME_LAT/LON optional
```

This overwrites `data/jobs.json`. Open `index.html` with any static file
server (e.g. `python3 -m http.server`) to view it.

## Why listing pages are rendered with a headless browser

Real run data (2026-09-21) showed that NEOGOV agency career microsites
(`governmentjobs.com/careers/{agency}`) and EDJOIN serve a fully
server-rendered page shell — real title, nav, footer, dozens of real links —
but the actual job-listing grid is injected by client-side JavaScript after
load, and is completely absent from the raw HTML a plain `fetch()` sees. A
search-engine cross-check confirmed real, currently-open postings exist at
exactly the URLs this scraper looks for, so the fix wasn't the URL pattern —
it was that the page needs to actually run its JavaScript before the job
list exists to read. `scraper/lib/browser.js` renders listing pages with
headless Chromium (via [Playwright](https://playwright.dev)) for this
reason. Job **detail** pages, once a URL is known, are still fetched with
plain HTTP and parsed via
[schema.org `JobPosting` JSON-LD](https://schema.org/JobPosting) — those
were confirmed to carry real structured data without needing a browser,
which keeps the 40-80 detail fetches per source fast.

## Diagnosing a source that returns 0 jobs

Check `sourceRunSummary` in `data/jobs.json` first:

- `"error"` with a message mentioning hrefs/anchors means the listing page
  loaded but no link matched the URL pattern in that adapter — the message
  lists every distinct href actually seen on the page (digit-containing
  ones first, since a job posting link almost always embeds a numeric id),
  which is normally enough to see the real pattern without needing to
  reproduce the fetch anywhere.
- `"ok"` with a `filterBreakdown` showing everything dropped by
  `droppedKeyword` means the source's own search/query params aren't
  actually filtering server-side (this is expected for GovernmentJobs.com's
  generic statewide search) — the scraper's own keyword filter is working
  correctly in that case, it just means none of what came back was IT-related.
- A redirect note (`[redirected to: ...]`) means the configured URL no
  longer resolves where expected — the agency likely changed its career
  site slug or retired the domain (this is what happened with Los Rios).

Run `npm run scrape` locally to reproduce and iterate faster than waiting
on a scheduled Action run.

## Deploying the dashboard

This is a static site (no build step), so it can be hosted as-is on GitHub
Pages: repo Settings → Pages → deploy from the `main` branch, root folder.
