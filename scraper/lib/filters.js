'use strict';

/**
 * True if a job title looks like one of the configured IT/technology roles.
 * Matches whole-word-ish phrases (case-insensitive) rather than loose
 * substrings, so e.g. "Information Technology Specialist" matches but
 * "Information Officer" does not.
 */
function matchesItKeyword(title, keywords) {
  if (!title) return false;
  const t = title.toLowerCase();
  return keywords.some((kw) => t.includes(kw.toLowerCase()));
}

/**
 * Resolves a county name from a free-text city string using the
 * city -> county lookup map. Returns null if the city isn't recognized.
 */
function resolveCounty(cityText, cityCountyMap) {
  if (!cityText) return null;
  const key = String(cityText).trim().toLowerCase();
  if (cityCountyMap[key]) return cityCountyMap[key];
  // try a loose contains-match for strings like "Sacramento, CA" or "City of Davis"
  const found = Object.keys(cityCountyMap).find((city) => key.includes(city));
  return found ? cityCountyMap[found] : null;
}

function isCountyEnabled(countyName, enabledCounties) {
  if (!countyName) return false;
  return enabledCounties.some((c) => c.toLowerCase() === countyName.toLowerCase());
}

module.exports = { matchesItKeyword, resolveCounty, isCountyEnabled };
