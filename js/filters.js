/**
 * Sorting (newest first) plus the "new"/"closing soon" badge logic, over
 * the already-scraped, already county/keyword-filtered, already
 * expiration-filtered job list in data/jobs.json.
 */
(function (global) {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  function daysUntil(isoDate) {
    if (!isoDate) return null;
    var closing = new Date(isoDate + 'T23:59:59');
    return Math.ceil((closing.getTime() - Date.now()) / DAY_MS);
  }

  function isClosingSoon(job, withinDays) {
    if (withinDays === undefined) withinDays = 7;
    var d = daysUntil(job.closingDate);
    return d !== null && d >= 0 && d <= withinDays;
  }

  function isNewJob(job, sinceDays) {
    if (sinceDays === undefined) sinceDays = 3;
    if (!job.firstSeen) return false;
    var ageMs = Date.now() - new Date(job.firstSeen).getTime();
    return ageMs >= 0 && ageMs <= sinceDays * DAY_MS;
  }

  function filterAndSortJobs(jobs) {
    return jobs.slice().sort(function (a, b) {
      return new Date(b.firstSeen || 0) - new Date(a.firstSeen || 0);
    });
  }

  global.Filters = {
    filterAndSortJobs: filterAndSortJobs,
    isClosingSoon: isClosingSoon,
    isNewJob: isNewJob,
    daysUntil: daysUntil,
  };
})(window);
