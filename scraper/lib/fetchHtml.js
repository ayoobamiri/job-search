'use strict';

const USER_AGENT =
  'Mozilla/5.0 (compatible; ITJobSearchDashboard/1.0; +personal job search aggregator)';

/**
 * Fetches a URL and returns response text. Retries transient failures
 * (network errors, 429, 5xx) with backoff. Returns null (instead of
 * throwing) on a final failure so one bad source/page never aborts the
 * whole scrape run.
 */
async function fetchText(url, opts) {
  const result = await fetchTextWithMeta(url, opts);
  return result ? result.text : null;
}

/** Same as fetchText, but also reports the post-redirect URL and HTTP
 * status -- useful for diagnosing a source whose configured URL now
 * redirects somewhere unexpected (a moved/retired career site page). */
async function fetchTextWithMeta(url, { retries = 2, timeoutMs = 20000, headers = {} } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
      } else if (!res.ok) {
        // Non-retryable client error (404, 403, etc). Report and stop.
        console.warn(`[fetchHtml] ${res.status} fetching ${url}`);
        return null;
      } else {
        return { text: await res.text(), finalUrl: res.url, status: res.status };
      }
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }

    if (attempt < retries) {
      const backoffMs = 1000 * Math.pow(2, attempt);
      await sleep(backoffMs);
    }
  }
  console.warn(`[fetchHtml] failed to fetch ${url}: ${lastError && lastError.message}`);
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { fetchText, fetchTextWithMeta, sleep, USER_AGENT };
