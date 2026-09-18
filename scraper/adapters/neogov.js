'use strict';

/**
 * Adapter for NEOGOV-powered career sites: governmentjobs.com and
 * schooljobs.com. Both platforms share the same underlying software, so
 * one adapter covers GovernmentJobs.com, SchoolJobs.com/careers/losrios,
 * governmentjobs.com/careers/elkgrove, and governmentjobs.com/careers/sacramento.
 *
 * ASSUMPTION (unverified in this environment -- this sandbox's network
 * policy blocks outbound requests to governmentjobs.com/schooljobs.com, so
 * the link-discovery selectors below could not be tested against live
 * markup): job detail pages are expected to carry schema.org JobPosting
 * JSON-LD (used for Google for Jobs indexing), which is parsed as the
 * primary, most reliable data source. DOM selectors are only a fallback
 * for when JSON-LD is missing, and a listing page's link-discovery
 * selectors are the most likely thing to need adjusting if NEOGOV's
 * markup differs from what's coded here -- check that first if a run
 * finds 0 jobs from an enabled NEOGOV source.
 */

const cheerio = require('cheerio');
const { fetchText, sleep } = require('../lib/fetchHtml');
const { extractJobPostings } = require('../lib/jsonld');
const { cleanSummary } = require('../lib/normalize');

const MAX_PAGES = 5;
const MAX_JOBS_PER_SOURCE = 80;
const DETAIL_FETCH_DELAY_MS = 500;

async function fetchListings(source) {
  const jobUrls = new Set();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = withPageParam(source.searchUrl, page);
    const html = await fetchText(pageUrl);
    if (!html) {
      if (page === 1) throw new Error(`Could not load listing page: ${pageUrl}`);
      break;
    }

    const $ = cheerio.load(html);
    const before = jobUrls.size;

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      if (/\/jobs\/\d+/.test(href) || /\/careers\/[^/]+\/jobs\/\d+/.test(href)) {
        jobUrls.add(absoluteUrl(href, source.searchUrl));
      }
    });

    const found = jobUrls.size - before;
    if (found === 0) break; // no new links on this page -> stop paginating
    if (jobUrls.size >= MAX_JOBS_PER_SOURCE) break;
  }

  const urls = [...jobUrls].slice(0, MAX_JOBS_PER_SOURCE);
  const jobs = [];

  for (const url of urls) {
    const job = await fetchJobDetail(url, source);
    if (job) jobs.push(job);
    await sleep(DETAIL_FETCH_DELAY_MS);
  }

  return jobs;
}

async function fetchJobDetail(url, source) {
  const html = await fetchText(url);
  if (!html) return null;

  const postings = extractJobPostings(html);
  if (postings.length > 0) {
    return normalizeFromJsonLd(postings[0], url, source);
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

function withPageParam(searchUrl, page) {
  if (page === 1) return searchUrl;
  const url = new URL(searchUrl);
  url.searchParams.set('page', String(page));
  return url.toString();
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

module.exports = { fetchListings };
