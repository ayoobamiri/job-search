'use strict';

const cheerio = require('cheerio');

/**
 * Builds a short, human-readable diagnosis of why a listing page yielded
 * zero job links, so a scrape run failure is actionable from the
 * committed jobs.json / Action logs alone -- without needing to
 * reproduce the fetch somewhere with live network access. Checks for the
 * common signs that a page's real content is injected by client-side
 * JavaScript after load (which a plain HTTP fetch can't see), since
 * that's the most likely reason a real career-site search page would
 * come back with a 200 response but no matching links.
 */
function diagnoseEmptyListing(html, url, finalUrl) {
  const $ = cheerio.load(html);
  const anchorCount = $('a').length;
  const scriptCount = $('script').length;
  const bodyTextLength = $('body').text().replace(/\s+/g, ' ').trim().length;
  const title = $('title').first().text().trim();

  const redirectNote = finalUrl && finalUrl !== url ? ` [redirected to: ${finalUrl}]` : '';

  const junkHref = /^(#|javascript:|mailto:|tel:)/i;
  const sampleHrefs = [];
  $('a[href]').each((_, el) => {
    if (sampleHrefs.length >= 15) return;
    const href = $(el).attr('href');
    if (href && !junkHref.test(href) && !sampleHrefs.includes(href)) sampleHrefs.push(href);
  });

  const spaMarkers = [];
  if ($('#root').length || $('#app').length) spaMarkers.push('root/app mount div');
  if (html.includes('__NEXT_DATA__')) spaMarkers.push('__NEXT_DATA__ (Next.js)');
  if (html.includes('__NUXT__')) spaMarkers.push('__NUXT__ (Nuxt)');
  if ($('[ng-version]').length) spaMarkers.push('Angular (ng-version)');
  if (html.includes('window.__INITIAL_STATE__') || html.includes('window.__PRELOADED_STATE__')) {
    spaMarkers.push('embedded initial-state JSON');
  }
  if ($('noscript').length && bodyTextLength < 500) spaMarkers.push('<noscript> present with very little body text');

  const likelyClientRendered = spaMarkers.length > 0 || (anchorCount < 5 && scriptCount > 0);

  return (
    `Listing page loaded (HTTP 200, title "${title}", ${bodyTextLength} chars of body text, ` +
    `${anchorCount} <a> tag(s), ${scriptCount} <script> tag(s)) but no job links matched the ` +
    `expected URL pattern.${redirectNote}` +
    (likelyClientRendered
      ? ` Likely client-rendered: ${spaMarkers.length ? spaMarkers.join(', ') : 'few anchors relative to script count'}. ` +
        `A plain HTTP fetch cannot see content injected by JavaScript after page load -- this source ` +
        `probably needs to be fetched with a headless browser instead. URL: ${url}`
      : ` Page does not look obviously JS-rendered, so the link-discovery regex in this adapter is ` +
        `probably just matching the wrong URL pattern for this site. URL: ${url}`) +
    (sampleHrefs.length ? ` Sample hrefs seen: ${JSON.stringify(sampleHrefs)}` : ' No non-trivial hrefs seen at all.')
  );
}

module.exports = { diagnoseEmptyListing };
