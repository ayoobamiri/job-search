'use strict';

/**
 * Adapter for NEOGOV-powered career sites: governmentjobs.com and
 * schooljobs.com. Both platforms share the same underlying software, so
 * one adapter covers GovernmentJobs.com, SchoolJobs.com/careers/losriosccd,
 * governmentjobs.com/careers/elkgrove, and governmentjobs.com/careers/sacramento.
 *
 * CONFIRMED (2026-09-21, real GitHub Actions run + a web search cross-check):
 * agency career-microsite search/listing pages (governmentjobs.com/careers/{agency})
 * are a server-rendered shell -- real title, nav, footer -- but the actual
 * job cards are injected by client-side JavaScript after load, so a plain
 * HTTP fetch never sees them even though the URLs/regex here are correct
 * (verified real, currently-open postings exist at exactly the URL pattern
 * this file looks for). Listing pages are therefore rendered with a
 * headless browser (lib/browser.js), which also scrolls/clicks to load the
 * full list rather than just a default first page -- a first pass at this
 * showed every source's discovered titles were an alphabetically-sorted
 * slice starting at "A" (i.e. a `?page=N` URL param does nothing on these
 * client-rendered lists; the real "next page" mechanism is scroll- or
 * click-driven), which meant "Information Technology ..." / "Technology
 * ..." titles further down the alphabet were never reached.
 *
 * Once the full list is loaded it can easily be 100-300 postings for a
 * source like Sacramento County, and fetching a full JSON-LD detail page
 * for every single one would be far too slow to run every few hours. So
 * the visible link text from the listing itself is matched against the IT
 * keyword list *before* committing to a detail fetch -- a full detail
 * fetch (and its JSON-LD parse) only happens for postings that already
 * look IT-related from their listing title, which is the expensive/slow
 * part this keeps small. Job *detail* pages, once a URL is known, are
 * fetched with plain HTTP -- confirmed to carry real schema.org JobPosting
 * JSON-LD without needing a browser.
 */

const cheerio = require('cheerio');
const { fetchText, sleep } = require('../lib/fetchHtml');
const { fetchRenderedHtml } = require('../lib/browser');
const { extractJobPostings } = require('../lib/jsonld');
const { cleanSummary } = require('../lib/normalize');
const { diagnoseEmptyListing } = require('../lib/diagnose');
const { matchesItKeyword } = require('../lib/filters');

const MAX_CANDIDATE_JOBS = 150; // safety cap on how many pre-filtered candidates get a full detail fetch
const DETAIL_FETCH_DELAY_MS = 500;

async function fetchListings(source, keywords) {
  const rendered = await fetchRenderedHtml(source.searchUrl);
  if (!rendered) throw new Error(`Could not load listing page: ${source.searchUrl}`);

  const candidates = new Map(); // url -> visible listing title
  for (const [href, text] of rendered.anchors) {
    if (!href) continue;
    if (!(/\/jobs\/\d+/.test(href) || /\/careers\/[^/]+\/jobs\/\d+/.test(href))) continue;
    const url = absoluteUrl(href, source.searchUrl);
    if (text && !candidates.has(url)) candidates.set(url, text);
  }

  if (candidates.size === 0) {
    throw new Error(diagnoseEmptyListing(rendered.text, source.searchUrl, rendered.finalUrl));
  }

  const allTitles = [...candidates.values()];
  console.log(
    `[neogov] ${source.id}: ${candidates.size} candidate link(s) after scroll. ` +
      `First 5: ${JSON.stringify(allTitles.slice(0, 5))} | Last 5: ${JSON.stringify(allTitles.slice(-5))}`
  );

  const matching = [...candidates.entries()]
    .filter(([, title]) => matchesItKeyword(title, keywords))
    .slice(0, MAX_CANDIDATE_JOBS);
  console.log(`[neogov] ${source.id}: ${matching.length} matched an IT keyword: ${JSON.stringify(matching.map(([, t]) => t))}`);

  const jobs = [];
  for (const [url] of matching) {
    try {
      const job = await fetchJobDetail(url, source);
      if (job) jobs.push(job);
    } catch (err) {
      console.warn(`[neogov] skipping ${url}: ${err.message}`);
    }
    await sleep(DETAIL_FETCH_DELAY_MS);
  }

  return jobs;
}

async function fetchJobDetail(url, source) {
  const html = await fetchText(url);
  if (!html) return null;

  const postings = extractJobPostings(html);
  if (postings.length > 0) {
    try {
      return normalizeFromJsonLd(postings[0], url, source);
    } catch (err) {
      // Re-throw with the actual posting payload attached so the real
      // shape that broke normalization is visible in the run's logs,
      // instead of just an opaque "reading 'trim' of undefined".
      const snapshot = JSON.stringify(postings[0]).slice(0, 800);
      err.message = `${err.message} | posting JSON-LD: ${snapshot}`;
      throw err;
    }
  }
  return normalizeFromDom(html, url, source);
}

function normalizeFromJsonLd(posting, url, source) {
  const location = Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation;
  const address = location && location.address;
  const city = address && (address.addressLocality || address.addressRegion) ? address.addressLocality : null;

  const salaryValue = posting.baseSalary && posting.baseSalary.value;
  let salaryText = null;
  if (salaryValue) {
    if (salaryValue.minValue != null && salaryValue.maxValue != null) {
      salaryText = `$${salaryValue.minValue} - $${salaryValue.maxValue} ${(salaryValue.unitText || '').toLowerCase()}`.trim();
    } else if (salaryValue.value != null) {
      salaryText = `$${salaryValue.value} ${(salaryValue.unitText || '').toLowerCase()}`.trim();
    }
  }

  const employer = plausibleEmployerName(posting.hiringOrganization && posting.hiringOrganization.name, source);

  return {
    title: posting.title || null,
    employer,
    city,
    salaryText,
    closingDateText: posting.validThrough || null,
    postedDateText: posting.datePosted || null,
    employmentType: posting.employmentType || null,
    summary: cleanSummary(posting.description),
    applyUrl: posting.url || url,
    sourceId: source.id,
    sourceName: source.name,
    sourceWebsite: source.website,
  };
}

/** Fallback when a NEOGOV detail page has no JSON-LD JobPosting block. */
function normalizeFromDom(html, url, source) {
  const $ = cheerio.load(html);
  const title = firstNonEmpty($('h1').text(), $('title').text());
  if (!title) return null;

  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const salaryText = matchAfterLabel(bodyText, /salary/i);
  const closingDateText = matchAfterLabel(bodyText, /closing date|application deadline|deadline/i);
  const employmentType = matchAfterLabel(bodyText, /job type|employment type/i);

  return {
    title: title.trim(),
    employer: plausibleEmployerName(null, source),
    city: null, // not confidently extractable without JSON-LD; county filtering will drop this job unless a later enrichment step resolves it
    salaryText: salaryText || null,
    closingDateText: closingDateText || null,
    postedDateText: null,
    employmentType: employmentType || null,
    summary: cleanSummary($('main').text() || $('body').text()),
    applyUrl: url,
    sourceId: source.id,
    sourceName: source.name,
    sourceWebsite: source.website,
  };
}

function plausibleEmployerName(candidate, source) {
  if (candidate && !/governmentjobs|schooljobs|neogov/i.test(candidate)) return candidate;
  return source.name;
}

function matchAfterLabel(text, labelRegex) {
  const re = new RegExp(labelRegex.source + '\\s*[:\\-]?\\s*([^.]{1,80})', labelRegex.flags.includes('i') ? 'i' : '');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function firstNonEmpty(...vals) {
  return vals.find((v) => v && v.trim()) || null;
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

module.exports = { fetchListings };
