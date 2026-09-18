'use strict';

const cheerio = require('cheerio');

/**
 * Extracts schema.org JobPosting objects embedded as JSON-LD in a page.
 * Government and school job boards generally publish this markup so their
 * listings appear in Google for Jobs, which makes it a far more stable
 * source of truth than guessing at CSS class names. Falls back to an
 * empty array if none is present (caller should fall back to DOM scraping).
 */
function extractJobPostings(html) {
  const $ = cheerio.load(html);
  const postings = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // malformed JSON-LD block; skip it
    }
    for (const node of flattenGraph(parsed)) {
      if (isJobPosting(node)) postings.push(node);
    }
  });

  return postings;
}

function flattenGraph(node) {
  if (Array.isArray(node)) return node.flatMap(flattenGraph);
  if (node && typeof node === 'object') {
    if (Array.isArray(node['@graph'])) return node['@graph'].flatMap(flattenGraph);
    return [node];
  }
  return [];
}

function isJobPosting(node) {
  const type = node && node['@type'];
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => String(t).toLowerCase() === 'jobposting');
}

module.exports = { extractJobPostings };
