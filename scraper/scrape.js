'use strict';

/**
 * Entry point: reads the shared config in job-search/data/, runs each
 * enabled source's adapter, filters results down to IT-related titles in
 * the configured counties, drops expired postings, dedupes across
 * sources, computes distance from home (if HOME_LAT/HOME_LON are set),
 * and writes job-search/data/jobs.json.
 *
 * Usage:
 *   HOME_LAT=38.58 HOME_LON=-121.49 node scrape.js
 *
 * HOME_LAT/HOME_LON are optional. Without them, jobs are still fetched
 * and filtered, just without a distanceMiles value (the frontend then
 * shows "Not provided" for distance and can still compute it client-side
 * if the user enters their home location in the browser).
 */

const fs = require('fs');
const path = require('path');

const neogov = require('./adapters/neogov');
const edjoin = require('./adapters/edjoin');
const { matchesItKeyword, resolveCounty, isCountyEnabled } = require('./lib/filters');
const { parseSalary, parseClosingDate, isExpired, normalizeEmploymentType } = require('./lib/normalize');
const { dedupeJobs } = require('./lib/dedupe');
const { geocodeCity, haversineMiles } = require('./lib/geocode');

const DATA_DIR = path.join(__dirname, '..', 'data');

const ADAPTERS = { neogov, edjoin };

async function main() {
  const sources = readJson(path.join(DATA_DIR, 'sources.json'));
  const counties = readJson(path.join(DATA_DIR, 'counties.json'));
  const keywords = readJson(path.join(DATA_DIR, 'keywords.json'));
  const cityCountyMap = readJson(path.join(DATA_DIR, 'city-county-map.json'));
  const previous = readJson(path.join(DATA_DIR, 'jobs.json'), { jobs: [] });
  const previousById = new Map((previous.jobs || []).map((j) => [j.id, j]));

  const enabledCounties = counties.filter((c) => c.enabled).map((c) => c.name);
  const enabledSources = sources.filter((s) => s.enabled);

  const home = readHomeLocation();

  const runSummary = [];
  let rawJobs = [];

  for (const source of enabledSources) {
    const adapter = ADAPTERS[source.type];
    if (!adapter) {
      console.warn(`[scrape] no adapter for source type "${source.type}" (${source.id}); skipping`);
      runSummary.push({ sourceId: source.id, sourceName: source.name, status: 'error', message: `Unknown source type "${source.type}"`, jobsFound: 0 });
      continue;
    }
    console.log(`[scrape] fetching ${source.name} (${source.id})...`);
    try {
      const jobs = await adapter.fetchListings(source);
      console.log(`[scrape]   -> ${jobs.length} raw listing(s)`);
      rawJobs.push(...jobs);
      runSummary.push({ sourceId: source.id, sourceName: source.name, status: 'ok', jobsFound: jobs.length });
    } catch (err) {
      console.error(`[scrape]   error fetching ${source.name}: ${err.message}`);
      runSummary.push({ sourceId: source.id, sourceName: source.name, status: 'error', message: err.message, jobsFound: 0 });
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();

  const processed = [];
  for (const raw of rawJobs) {
    if (!raw.title || !raw.applyUrl) continue;
    if (!matchesItKeyword(raw.title, keywords)) continue;

    const county = resolveCounty(raw.city, cityCountyMap);
    if (!isCountyEnabled(county, enabledCounties)) continue;

    const salary = parseSalary(raw.salaryText);
    const closingDate = parseClosingDate(raw.closingDateText);
    if (isExpired(closingDate, now)) continue;

    processed.push({
      title: raw.title.trim(),
      employer: raw.employer || 'Not provided',
      city: raw.city || 'Not provided',
      county,
      salaryText: raw.salaryText || 'Not provided',
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryPeriod: salary.period,
      closingDate, // ISO date or null
      noClosingDate: closingDate === null,
      employmentType: normalizeEmploymentType(raw.employmentType),
      summary: raw.summary || null,
      applyUrl: raw.applyUrl,
      postedDate: raw.postedDateText ? safeIso(raw.postedDateText) : null,
      sourceId: raw.sourceId,
      sourceName: raw.sourceName,
      sourceWebsite: raw.sourceWebsite,
      fetchedAt: nowIso,
    });
  }

  const deduped = dedupeJobs(processed);

  // Geocode each unique city (cached across runs) and compute distance from home.
  const cityCoordCache = new Map();
  for (const job of deduped) {
    const cityKey = `${job.city}`.toLowerCase();
    if (!cityCoordCache.has(cityKey) && job.city && job.city !== 'Not provided') {
      const coords = await geocodeCity(job.city);
      cityCoordCache.set(cityKey, coords);
    }
    const cityCoords = cityCoordCache.get(cityKey) || null;
    job.cityLat = cityCoords ? cityCoords.lat : null;
    job.cityLon = cityCoords ? cityCoords.lon : null;
    job.distanceMiles = home && cityCoords ? haversineMiles(home, cityCoords) : null;

    const prior = previousById.get(job.id);
    job.firstSeen = prior ? prior.firstSeen : nowIso;
    job.isNew = !prior;
  }

  deduped.sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));

  const output = {
    lastUpdated: nowIso,
    lastRunStatus: runSummary.some((s) => s.status === 'error') ? 'partial' : 'ok',
    homeDistanceAvailable: Boolean(home),
    sourceRunSummary: runSummary,
    jobs: deduped,
  };

  fs.writeFileSync(path.join(DATA_DIR, 'jobs.json'), JSON.stringify(output, null, 2));
  console.log(`[scrape] wrote ${deduped.length} active job(s) to data/jobs.json`);
}

function readHomeLocation() {
  const lat = parseFloat(process.env.HOME_LAT);
  const lon = parseFloat(process.env.HOME_LON);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return null;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

function safeIso(dateText) {
  const d = new Date(dateText);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

main().catch((err) => {
  console.error('[scrape] fatal error:', err);
  process.exitCode = 1;
});
