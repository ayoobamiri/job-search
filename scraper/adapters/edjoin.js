'use strict';

/**
 * Adapter for EDJOIN.org, California's K-12 / education job board.
 *
 * CONFIRMED (2026-09-21, real GitHub Actions run): the search/listing page
 * is a server-rendered shell but the actual job grid is injected by
 * client-side JavaScript, so listing pages are rendered with a headless
 * browser (lib/browser.js), which also scrolls/clicks to load the full
 * list -- a first pass showed every discovered title was an
 * alphabetically-sorted slice starting at "A", meaning a `?page=N` URL
 * param does nothing here and postings further down the alphabet (most
 * "Technology ..." titles) were never reached with only a single default
 * page loaded.
 *
 * The full list can run into the hundreds of postings, so the visible
 * listing-link text is matched against the IT keyword list *before*
 * committing to a full detail fetch -- only candidates that already look
 * IT-related get a JSON-LD detail fetch, which is what makes this fast
 * enough to run every few hours. Job detail pages, once a URL is known,
 * are fetched with plain HTTP and parsed via schema.org JobPosting JSON-LD.
 */

const cheerio = require('cheerio');
const { fetchText, sleep } = require('../lib/fetchHtml');
const { fetchRenderedHtml } = require('../lib/browser');
const { extractJobPostings } = require('../lib/jsonld');
const { cleanSummary } = require('../lib/normalize');
const { diagnoseEmptyListing } = require('../lib/diagnose');
const { matchesItKeyword } = require('../lib/filters');

const MAX_CANDIDATE_JOBS = 150;
const DETAIL_FETCH_DELAY_MS = 500;

async function fetchListings(source, keywords) {
  const rendered = await fetchRenderedHtml(source.searchUrl);
  if (!rendered) throw new Error(`Could not load listing page: ${source.searchUrl}`);

  const candidates = new Map();
  for (const [href, text] of rendered.anchors) {
    if (!href) continue;
    if (!/JobPosting|JobDetail|\/Jobs\/Details|PostingID=\d+/i.test(href)) continue;
    const url = absoluteUrl(href, source.searchUrl);
    if (text && !candidates.has(url)) candidates.set(url, text);
  }

  if (candidates.size === 0) {
    throw new Error(diagnoseEmptyListing(rendered.text, source.searchUrl, rendered.finalUrl));
  }

  const allTitles = [...candidates.values()];
  console.log(
    `[edjoin] ${source.id}: ${candidates.size} candidate link(s) after scroll. ` +
      `First 5: ${JSON.stringify(allTitles.slice(0, 5))} | Last 5: ${JSON.stringify(allTitles.slice(-5))}`
  );

  const matching = [...candidates.entries()]
    .filter(([, title]) => matchesItKeyword(title, keywords))
    .slice(0, MAX_CANDIDATE_JOBS);
  console.log(`[edjoin] ${source.id}: ${matching.length} matched an IT keyword: ${JSON.stringify(matching.map(([, t]) => t))}`);

  const jobs = [];
  for (const [url] of matching) {
    try {
      const job = await fetchJobDetail(url, source);
      if (job) jobs.push(job);
    } catch (err) {
      console.warn(`[edjoin] skipping ${url}: ${err.message}`);
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
  const city = address ? address.addressLocality : null;

  const salaryValue = posting.baseSalary && posting.baseSalary.value;
  let salaryText = null;
  if (salaryValue) {
    if (salaryValue.minValue != null && salaryValue.maxValue != null) {
      salaryText = `$${salaryValue.minValue} - $${salaryValue.maxValue} ${(salaryValue.unitText || '').toLowerCase()}`.trim();
    } else if (salaryValue.value != null) {
      salaryText = `$${salaryValue.value} ${(salaryValue.unitText || '').toLowerCase()}`.trim();
    }
  }

  const employer = (posting.hiringOrganization && posting.hiringOrganization.name) || source.name;

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

function normalizeFromDom(html, url, source) {
  const $ = cheerio.load(html);
  const title = firstNonEmpty($('h1').text(), $('title').text());
  if (!title) return null;

  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const employerMatch = matchAfterLabel(bodyText, /district|employer/i);
  const salaryText = matchAfterLabel(bodyText, /salary/i);
  const closingDateText = matchAfterLabel(bodyText, /closing date|application deadline|deadline/i);
  const employmentType = matchAfterLabel(bodyText, /job type|employment type|position type/i);

  return {
    title: title.trim(),
    employer: employerMatch || source.name,
    city: null,
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
