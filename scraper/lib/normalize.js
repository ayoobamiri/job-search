'use strict';

/**
 * Best-effort parsing of free-text salary strings into a numeric range +
 * period. Returns nulls (never invented numbers) when the text doesn't
 * match a recognizable pattern -- the raw text is always preserved
 * separately so nothing is lost.
 */
function parseSalary(input) {
  if (!input) return { min: null, max: null, period: null };
  const text = String(input).replace(/,/g, '');

  const periodMatch = text.match(/\b(hour|hourly|hr|month|monthly|mo|year|yearly|annual|annually|yr)\b/i);
  let period = null;
  if (periodMatch) {
    const p = periodMatch[1].toLowerCase();
    if (p.startsWith('hour') || p === 'hr') period = 'hour';
    else if (p.startsWith('month') || p === 'mo') period = 'month';
    else if (p.startsWith('year') || p.startsWith('annual') || p === 'yr') period = 'year';
  }

  const numbers = [...text.matchAll(/\$\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  if (numbers.length === 0) return { min: null, max: null, period };
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0], period };
  return { min: Math.min(...numbers), max: Math.max(...numbers), period };
}

/**
 * Best-effort parsing of a closing/due date string into an ISO date
 * (YYYY-MM-DD). Returns null if it cannot be confidently parsed or if the
 * text indicates an open/continuous posting -- callers must treat null as
 * "no closing date provided", never as "never expires".
 */
function parseClosingDate(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (/continuous|open until filled|ongoing|no closing date/i.test(text)) return null;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoDate(parsed);
  }
  return null;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isExpired(isoDate, now = new Date()) {
  if (!isoDate) return false; // no date provided -> not treated as expired
  const closing = new Date(`${isoDate}T23:59:59`);
  return closing.getTime() < now.getTime();
}

function normalizeEmploymentType(input) {
  if (!input) return null;
  const text = String(input).toUpperCase();
  if (text.includes('FULL')) return 'Full-time';
  if (text.includes('PART')) return 'Part-time';
  if (text.includes('TEMP')) return 'Temporary';
  if (text.includes('INTERN')) return 'Internship';
  if (text.includes('CONTRACT')) return 'Contract';
  return String(input).trim() || null;
}

/** Collapses whitespace and strips HTML tags from a summary/description. */
function cleanSummary(input, maxLength = 320) {
  if (!input) return null;
  const text = String(input)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

module.exports = {
  parseSalary,
  parseClosingDate,
  isExpired,
  normalizeEmploymentType,
  cleanSummary,
  toIsoDate,
};
