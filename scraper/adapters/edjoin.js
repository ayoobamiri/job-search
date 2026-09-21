'use strict';

/**
 * Adapter for EDJOIN.org, California's K-12 / education job board.
 *
 * CONFIRMED (2026-09-21, real GitHub Actions run): the search/listing page
 * is a server-rendered shell (real title, nav, footer, 46 <script> tags)
 * but exposes zero job-related links among its anchors -- consistent with
 * the same client-side-rendered job grid seen on NEOGOV agency microsites.
 * Listing pages are rendered with a headless browser (lib/browser.js). Job
 * detail pages, once a URL is known, are still fetched with plain HTTP and
 * parsed primarily via schema.org JobPosting JSON-LD.
 */

const cheerio = require('cheerio');
const { fetchText, sleep } = require('../lib/fetchHtml');
const { fetchRenderedHtml } = require('../lib/browser');
const { extractJobPostings } = require('../lib/jsonld');
const { cleanSummary } = require('../lib/normalize');
const { diagnoseEmptyListing } = require('../lib/diagnose');

const MAX_PAGES = 5;
const MAX_JOBS_PER_SOURCE = 80;
const DETAIL_FETCH_DELAY_MS = 500;

async function fetchListings(source) {
  const jobUrls = new Set();
  let firstPageHtml = null;
  let firstPageFinalUrl = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = withPageParam(source.searchUrl, page);
    const rendered = await fetchRenderedHtml(pageUrl);
    const html = rendered && rendered.text;
    if (page === 1) firstPageFinalUrl = rendered && rendered.finalUrl;
    if (!html) {
      if (page === 1) throw new Error(`Could not load listing page: ${pageUrl}`);
      break;
    }
    if (page === 1) firstPageHtml = html;

    const $ = cheerio.load(html);
    const before = jobUrls.size;

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      if (/JobPosting|JobDetail|\/Jobs\/Details|PostingID=\d+/i.test(href)) {
        jobUrls.add(absoluteUrl(href, source.searchUrl));
      }
    });

    const found = jobUrls.size - before;
    if (found === 0) break;
    if (jobUrls.size >= MAX_JOBS_PER_SOURCE) break;
  }

  if (jobUrls.size === 0) {
    throw new Error(diagnoseEmptyListing(firstPageHtml, source.searchUrl, firstPageFinalUrl));
  }

  const urls = [...jobUrls].slice(0, MAX_JOBS_PER_SOURCE);
  const jobs = [];

  for (const url of urls) {
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
    return normalizeFromJsonLd(postings[0], url, source);
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

function withPageParam(searchUrl, page) {
  if (page === 1) return searchUrl;
  try {
    const url = new URL(searchUrl);
    url.searchParams.set('page', String(page));
    return url.toString();
  } catch {
    return searchUrl;
  }
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

module.exports = { fetchListings };
