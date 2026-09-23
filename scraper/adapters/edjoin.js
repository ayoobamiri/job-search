'use strict';

/**
 * Adapter for EDJOIN.org, California's K-12 / education job board.
 *
 * CONFIRMED (2026-09-21, real GitHub Actions run, request/response
 * logging via lib/browser.js's diagnostic logger): the listing page's own
 * "Search" control fires an internal JSON API, `GET /Home/LoadJobs`, which
 * is what actually serves job data -- the outer page's HTML/URL query
 * params are cosmetic only and are not what a real search submission uses.
 * That response's `data` array carries every field this adapter needs
 * (title, district, city, salary, dates, employment type, summary) plus
 * each posting's own `countyName`/`countyID`, confirmed against three real
 * records (Kern=15, Los Angeles=19, Riverside=33, matching standard
 * alphabetical CA county numbering). Filtering to target counties uses
 * each posting's own `countyName` rather than a city-name lookup, since
 * EDJOIN postings span far more CA cities than any curated map could
 * reasonably cover.
 *
 * This means no headless browser is needed for EDJOIN at all -- the API is
 * called directly with plain HTTP, once per IT keyword (the `keywords`
 * param name is exactly what the response's own echoed `search` object
 * uses, i.e. it is the real parameter the site's search box populates),
 * paginating a keyword's results if it has more than one page. The
 * response already contains full posting detail, so unlike neogov.js there
 * is no separate per-job detail-page fetch step.
 */

const { fetchText, sleep } = require('../lib/fetchHtml');
const { cleanSummary } = require('../lib/normalize');

const API_URL = 'https://www.edjoin.org/Home/LoadJobs';
const ROWS_PER_PAGE = 200;
const MAX_PAGES_PER_KEYWORD = 3;
const REQUEST_DELAY_MS = 250;

// Diagnostic only (2026-09-23): a user reported specific Sacramento-area
// districts (San Juan Unified, Washington Unified) not showing up, despite
// this adapter now fetching EDJOIN's real API. Logs whether each district's
// postings are (a) never returned by any keyword query at all -- meaning
// per-keyword pagination is missing them, or the district simply has no
// current IT-related posting -- or (b) returned but dropped by the county
// filter, in which case the logged countyName reveals a naming mismatch.
// Safe to remove once the real cause is confirmed from a run's logs.
const WATCH_DISTRICTS = ['san juan', 'washington'];

async function fetchListings(source, keywords, counties) {
  const targetCounties = new Set(
    (counties || [])
      .filter((c) => c.enabled)
      .map((c) => c.name.replace(/\s+County$/i, '').trim().toLowerCase())
  );

  const byPostingId = new Map();
  const keywordStats = [];

  for (const keyword of keywords) {
    let page = 1;
    let totalPages = 1;
    let totalRecords = null;

    do {
      const url = buildUrl(keyword, page);
      const body = await fetchText(url, {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: source.searchUrl,
        },
      });
      if (!body) break;

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        console.warn(`[edjoin] non-JSON response for keyword "${keyword}" page ${page}: ${err.message}`);
        break;
      }

      if (totalRecords === null) totalRecords = parsed.totalRecords || 0;
      const data = Array.isArray(parsed.data) ? parsed.data : [];
      for (const rec of data) {
        if (rec && rec.postingID != null && !byPostingId.has(rec.postingID)) {
          byPostingId.set(rec.postingID, rec);
        }
      }

      totalPages = parsed.totalPages || 1;
      page++;
      await sleep(REQUEST_DELAY_MS);
    } while (page <= totalPages && page <= MAX_PAGES_PER_KEYWORD);

    if (totalPages > MAX_PAGES_PER_KEYWORD) {
      console.warn(
        `[edjoin][debug] keyword "${keyword}" has ${totalPages} total pages (totalRecords=${totalRecords}) ` +
          `but only the first ${MAX_PAGES_PER_KEYWORD} were fetched -- older/lower-ranked matches for this keyword were not seen.`
      );
    }

    keywordStats.push({ keyword, totalRecords });
  }

  // Statewide totalRecords for an unfiltered call was 16133 (confirmed
  // 2026-09-21). If a keyword's own totalRecords comes back at/near that
  // same number, the `keywords` param likely isn't actually filtering
  // server-side for that query -- surfaced here so a future run's logs can
  // confirm or rule that out without another debugging round-trip.
  const suspicious = keywordStats.filter((s) => s.totalRecords != null && s.totalRecords > 5000);
  if (suspicious.length > 0) {
    console.warn(
      `[edjoin] ${source.id}: ${suspicious.length} keyword(s) returned suspiciously high totalRecords ` +
        `(keywords param may not be filtering server-side): ${JSON.stringify(suspicious.slice(0, 5))}`
    );
  }

  console.log(`[edjoin] ${source.id}: ${byPostingId.size} unique posting(s) across ${keywords.length} keyword queries`);

  const watched = [...byPostingId.values()].filter((rec) =>
    WATCH_DISTRICTS.some((name) => String(rec.districtName || '').toLowerCase().includes(name))
  );
  if (watched.length > 0) {
    console.log(
      `[edjoin][debug] found ${watched.length} posting(s) from watched districts: ` +
        JSON.stringify(watched.map((r) => ({ district: r.districtName, county: r.countyName, title: r.positionTitle, postingID: r.postingID })))
    );
  } else {
    console.log(`[edjoin][debug] no postings found from watched districts (${WATCH_DISTRICTS.join(', ')}) across any keyword query`);
  }

  // Ground truth for the watched districts: query EDJOIN by district name
  // itself (not an IT keyword) to see every current posting from that
  // district, independent of our IT keyword list or per-keyword pagination
  // limits -- this tells us whether the district simply has no open IT
  // posting right now, or has one whose title our keyword list isn't
  // catching.
  for (const districtQuery of ['San Juan Unified', 'Washington Unified']) {
    const url = buildUrl(districtQuery, 1);
    const body = await fetchText(url, {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: source.searchUrl,
      },
    });
    if (!body) {
      console.log(`[edjoin][debug] ground-truth query for "${districtQuery}" failed to fetch`);
      continue;
    }
    try {
      const parsed = JSON.parse(body);
      const data = Array.isArray(parsed.data) ? parsed.data : [];
      console.log(
        `[edjoin][debug] ground-truth query "${districtQuery}": totalRecords=${parsed.totalRecords}, ` +
          `titles=${JSON.stringify(data.map((r) => r.positionTitle))}`
      );
    } catch (err) {
      console.log(`[edjoin][debug] ground-truth query for "${districtQuery}" returned non-JSON: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const jobs = [];
  for (const rec of byPostingId.values()) {
    const countyKey = rec.countyName ? String(rec.countyName).trim().toLowerCase() : null;
    if (targetCounties.size > 0 && (!countyKey || !targetCounties.has(countyKey))) continue;
    jobs.push(normalizeRecord(rec, source));
  }

  console.log(`[edjoin] ${source.id}: ${jobs.length} posting(s) kept after county filter`);
  return jobs;
}

function buildUrl(keyword, page) {
  const params = new URLSearchParams({
    rows: String(ROWS_PER_PAGE),
    page: String(page),
    sort: 'postingDate',
    sortVal: '0',
    order: 'desc',
    keywords: keyword,
    location: '',
    searchType: 'all',
    regions: '',
    jobTypes: '',
    days: '0',
    empType: '',
    catID: '0',
    onlineApps: '',
    recruitmentCenterID: '0',
    stateID: '0',
    regionID: '0',
    districtID: '0',
    searchID: '0',
    _: String(Date.now()),
  });
  return `${API_URL}?${params.toString()}`;
}

function normalizeRecord(rec, source) {
  return {
    title: rec.positionTitle || null,
    employer: rec.districtName || source.name,
    city: rec.city || null,
    county: rec.countyName ? `${rec.countyName} County` : null,
    salaryText: buildSalaryText(rec),
    closingDateText: rec.displayFlag === 'By Date' ? parseDotNetDate(rec.displayUntil) : null,
    postedDateText: parseDotNetDate(rec.postingDate),
    employmentType: rec.FullTimePartTime || null,
    summary: cleanSummary(rec.JobSummary),
    applyUrl: `https://www.edjoin.org/Home/JobPosting/${rec.postingID}`,
    sourceId: source.id,
    sourceName: source.name,
    sourceWebsite: source.website,
  };
}

function buildSalaryText(rec) {
  if (rec.SalaryInfoSelect === 'Pay Range' && (rec.PayRangeFrom || rec.PayRangeTo)) {
    return `${rec.PayRangeFrom || '?'} - ${rec.PayRangeTo || '?'} ${periodFromDropdown(rec.PayRangeDropdown)}`.trim();
  }
  if (rec.SalaryInfoSelect === 'Single Rate' && rec.SingleRate) {
    return `${rec.SingleRate} ${periodFromDropdown(rec.SingleRateDropdown)}`.trim();
  }
  if (rec.salaryInfo && String(rec.salaryInfo).trim()) return String(rec.salaryInfo).trim();
  if (rec.beginningSalary != null && rec.endingSalary != null) {
    return `$${rec.beginningSalary} - $${rec.endingSalary}`;
  }
  return null;
}

function periodFromDropdown(dropdown) {
  if (!dropdown) return '';
  if (/hour/i.test(dropdown)) return 'per hour';
  if (/month/i.test(dropdown)) return 'per month';
  if (/year|annual/i.test(dropdown)) return 'per year';
  return dropdown;
}

/** EDJOIN dates arrive as .NET's `/Date(ms)/` wire format; returns an ISO string. */
function parseDotNetDate(value) {
  if (!value) return null;
  const m = /\/Date\((-?\d+)\)\//.exec(value);
  if (!m) return null;
  const ms = parseInt(m[1], 10);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { fetchListings };
