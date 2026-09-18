'use strict';

const fs = require('fs');
const path = require('path');
const { fetchText, sleep, USER_AGENT } = require('./fetchHtml');

const CACHE_PATH = path.join(__dirname, '..', '.geocode-cache.json');
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/**
 * Geocodes "City, CA" style strings to {lat, lon} using OpenStreetMap's
 * free Nominatim API (no key required). Results are cached to disk across
 * runs so repeated cities don't re-hit the service, and lookups are
 * rate-limited to Nominatim's 1 request/second usage policy. Returns null
 * (never a guessed coordinate) if a place can't be resolved.
 */
async function geocodeCity(cityText, state = 'California') {
  const cache = geocodeCity._cache || (geocodeCity._cache = loadCache());
  const key = `${cityText}, ${state}`.toLowerCase();
  if (key in cache) return cache[key];

  const query = new URLSearchParams({
    q: `${cityText}, ${state}, USA`,
    format: 'json',
    limit: '1',
  });
  const url = `${NOMINATIM_URL}?${query.toString()}`;

  await sleep(1100); // respect Nominatim's 1 req/sec policy
  const body = await fetchText(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US' },
  });

  let result = null;
  if (body) {
    try {
      const results = JSON.parse(body);
      if (Array.isArray(results) && results.length > 0) {
        result = { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
      }
    } catch {
      result = null;
    }
  }

  cache[key] = result;
  saveCache(cache);
  return result;
}

/** Great-circle distance in miles between two lat/lon points. */
function haversineMiles(a, b) {
  if (!a || !b) return null;
  const R = 3958.8; // Earth radius, miles
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c * 10) / 10;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

module.exports = { geocodeCity, haversineMiles };
