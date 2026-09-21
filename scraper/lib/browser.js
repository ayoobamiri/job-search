'use strict';

/**
 * Shared headless-Chromium helper. Real run data (2026-09-21) confirmed
 * that NEOGOV agency career microsites (governmentjobs.com/careers/{agency})
 * and EDJOIN serve a server-rendered page shell -- real title, nav, footer,
 * dozens of real links -- but the actual job-listing grid is injected by
 * client-side JavaScript after load and is completely absent from the raw
 * HTML a plain fetch() sees. A search-engine check confirmed real, currently
 * open IT postings exist on these exact pages with URLs matching this
 * adapter's regex, so the fix isn't the URL or the pattern -- it's that the
 * listing page needs to actually run its JavaScript before it can be read.
 * Job *detail* pages (once a URL is known) are still fetched with plain
 * HTTP, since those were confirmed to carry real schema.org JobPosting
 * JSON-LD without needing a browser.
 */

const { chromium } = require('playwright');
const { USER_AGENT } = require('./fetchHtml');

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

/**
 * Loads a URL in a headless browser, waits for network activity to settle
 * (plus a fixed grace period for a client-rendered job list to populate
 * after its own XHR/fetch call), and returns the fully rendered HTML plus
 * the post-redirect URL. Returns null on failure rather than throwing, to
 * match fetchHtml's contract.
 */
async function fetchRenderedHtml(url, { waitAfterLoadMs = 4000, timeoutMs = 30000, retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let page;
    try {
      const browser = await getBrowser();
      page = await browser.newPage({ userAgent: USER_AGENT });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      // networkidle can hang forever on pages with polling/analytics beacons,
      // so treat it as best-effort rather than something we wait strictly for.
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
      await page.waitForTimeout(waitAfterLoadMs);
      const html = await page.content();
      const finalUrl = page.url();
      return { text: html, finalUrl };
    } catch (err) {
      console.warn(`[browser] attempt ${attempt + 1} failed for ${url}: ${err.message}`);
      if (attempt === retries) return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
  return null;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close().catch(() => {});
}

module.exports = { fetchRenderedHtml, closeBrowser };
