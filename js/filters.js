/**
 * Client-side filtering & sorting over the already-scraped, already
 * county/keyword-filtered, already expiration-filtered job list in
 * data/jobs.json. This module only narrows further based on what the
 * visitor typed into the toolbar -- it never adds jobs that weren't in
 * the source data.
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

  function filterAndSortJobs(jobs, filters) {
    var out = jobs.filter(function (job) {
      if (filters.keyword) {
        var kw = filters.keyword.toLowerCase();
        var haystack = (job.title + ' ' + job.employer + ' ' + (job.summary || '')).toLowerCase();
        if (haystack.indexOf(kw) === -1) return false;
      }
      if (filters.county && job.county !== filters.county) return false;
      return true;
    });

    var sortKey = filters.sort || 'newest';
    out.sort(function (a, b) {
      switch (sortKey) {
        case 'closing': {
          var ad = a.closingDate ? new Date(a.closingDate).getTime() : Infinity;
          var bd = b.closingDate ? new Date(b.closingDate).getTime() : Infinity;
          return ad - bd;
        }
        case 'salary-high':
          return (b.salaryMax ?? b.salaryMin ?? -Infinity) - (a.salaryMax ?? a.salaryMin ?? -Infinity);
        case 'title':
          return a.title.localeCompare(b.title);
        case 'newest':
        default:
          return new Date(b.firstSeen || 0) - new Date(a.firstSeen || 0);
      }
    });

    return out;
  }

  global.Filters = {
    filterAndSortJobs: filterAndSortJobs,
    isClosingSoon: isClosingSoon,
    isNewJob: isNewJob,
    daysUntil: daysUntil,
  };
})(window);
