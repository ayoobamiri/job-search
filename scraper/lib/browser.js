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
 * after its own XHR/fetch call), then repeatedly scrolls to the bottom and
 * clicks any "load more" / "next page" control it can find, accumulating
 * page height growth, since real run data (2026-09-21) showed these career
 * sites' job lists load via infinite-scroll/click-to-load rather than a
 * `?page=N` URL param -- the very first render only ever contained a
 * default-sized alphabetical slice of the full list (every source's first
 * observed titles started with "A"), so postings further down the
 * alphabet (most "Information Technology ..." / "Technology ..." titles)
 * were never reached. Returns the fully rendered, fully-scrolled HTML plus
 * the post-redirect URL. Returns null on failure rather than throwing, to
 * match fetchHtml's contract.
 */
async function fetchRenderedHtml(url, { waitAfterLoadMs = 4000, timeoutMs = 30000, retries = 1, maxLoadSteps = 25 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let page;
    try {
      const browser = await getBrowser();
      // A modest viewport means even a short job list overflows and
      // engages scroll-triggered lazy loading sooner than a full desktop
      // viewport would.
      page = await browser.newPage({ userAgent: USER_AGENT, viewport: { width: 1024, height: 500 } });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      // networkidle can hang forever on pages with polling/analytics beacons,
      // so treat it as best-effort rather than something we wait strictly for.
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
      await page.waitForTimeout(waitAfterLoadMs);

      await loadFullList(page, maxLoadSteps);

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

/**
 * Scrolls to the bottom and clicks any visible "load more"/"next"-style
 * control repeatedly until the page stops growing for two consecutive
 * attempts, or maxLoadSteps is hit. Growth is measured by document height
 * as a platform-agnostic proxy for "more content appeared" -- it doesn't
 * need to know each site's specific markup.
 */
async function loadFullList(page, maxLoadSteps) {
  let lastHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
  let stableCount = 0;

  for (let step = 0; step < maxLoadSteps && stableCount < 2; step++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await clickLoadMoreIfPresent(page);
    await page.waitForTimeout(900);

    const height = await page.evaluate(() => document.body.scrollHeight).catch(() => lastHeight);
    if (height <= lastHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      lastHeight = height;
    }
  }
}

async function clickLoadMoreIfPresent(page) {
  try {
    const control = page
      .getByRole('button', { name: /load more|show more|next|view more/i })
      .or(page.getByRole('link', { name: /load more|show more|next|view more/i }))
      .first();
    if (await control.isVisible({ timeout: 300 }).catch(() => false)) {
      await control.click({ timeout: 1000 }).catch(() => {});
    }
  } catch {
    // No such control on this page -- that's fine, scrolling alone covers infinite-scroll lists.
  }
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close().catch(() => {});
}

module.exports = { fetchRenderedHtml, closeBrowser };
