/**
 * Distance helpers. Distance is never invented: it is only shown when the
 * job has known city coordinates (cityLat/cityLon, geocoded by the
 * scraper) AND a home location is known -- either the default computed at
 * scrape time (job.distanceMiles) or this browser's local override.
 */
(function (global) {
  'use strict';

  function haversineMiles(a, b) {
    if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
    var R = 3958.8;
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lon - a.lon);
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    var c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return Math.round(R * c * 10) / 10;
  }

  function toRad(deg) { return (deg * Math.PI) / 180; }

  /** Effective distance for a job: browser override takes precedence over
   * the value computed at scrape time. */
  function effectiveDistance(job, homeOverride) {
    if (homeOverride && job.cityLat != null && job.cityLon != null) {
      return haversineMiles(homeOverride, { lat: job.cityLat, lon: job.cityLon });
    }
    return typeof job.distanceMiles === 'number' ? job.distanceMiles : null;
  }

  function formatDistance(miles) {
    if (miles == null) return 'Not provided';
    return miles + ' mi from home';
  }

  global.Distance = { haversineMiles: haversineMiles, effectiveDistance: effectiveDistance, formatDistance: formatDistance };
})(window);
