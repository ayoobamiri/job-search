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

  var HOURS_PER_MONTH = 173.33; // 40 hrs/week * 52 weeks / 12 months, standard full-time equivalent

  /** Converts a salary figure to a monthly-equivalent for apples-to-apples
   * filtering/sorting across hourly/monthly/annual postings. Never used
   * for display -- the original salaryText/min/max/period is always shown
   * on the card as scraped. Returns null if the period is unknown, since
   * an unlabeled number can't be safely converted. */
  function monthlyEquivalent(amount, period) {
    if (amount == null) return null;
    if (period === 'hour') return amount * HOURS_PER_MONTH;
    if (period === 'year') return amount / 12;
    if (period === 'month') return amount;
    return null;
  }

  function filterAndSortJobs(jobs, filters, homeOverride, favorites) {
    var out = jobs.filter(function (job) {
      if (filters.keyword) {
        var kw = filters.keyword.toLowerCase();
        var haystack = (job.title + ' ' + job.employer + ' ' + (job.summary || '')).toLowerCase();
        if (haystack.indexOf(kw) === -1) return false;
      }
      if (filters.county && job.county !== filters.county) return false;
      if (filters.city) {
        if (!job.city || job.city.toLowerCase().indexOf(filters.city.toLowerCase()) === -1) return false;
      }
      if (filters.employer) {
        if (!job.employer || job.employer.toLowerCase().indexOf(filters.employer.toLowerCase()) === -1) return false;
      }
      if (filters.source && job.sourceId !== filters.source) return false;
      if (filters.employmentType && job.employmentType !== filters.employmentType) return false;

      if (filters.salaryMin != null && filters.salaryMin !== '') {
        var jobMaxMonthly = monthlyEquivalent(job.salaryMax, job.salaryPeriod);
        if (jobMaxMonthly == null || jobMaxMonthly < monthlyEquivalent(Number(filters.salaryMin), 'month')) return false;
      }
      if (filters.salaryMax != null && filters.salaryMax !== '') {
        var jobMinMonthly = monthlyEquivalent(job.salaryMin, job.salaryPeriod);
        if (jobMinMonthly == null || jobMinMonthly > monthlyEquivalent(Number(filters.salaryMax), 'month')) return false;
      }

      if (filters.maxDistance != null && filters.maxDistance !== '') {
        var dist = global.Distance.effectiveDistance(job, homeOverride);
        if (dist == null || dist > Number(filters.maxDistance)) return false;
      }

      if (filters.deadline === 'soon' && !isClosingSoon(job, 7)) return false;
      if (filters.deadline === '30' && !isClosingSoon(job, 30)) return false;
      if (filters.deadline === 'nodate' && !job.noClosingDate) return false;

      if (filters.favoritesOnly && favorites.indexOf(job.id) === -1) return false;

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
        case 'salary-low':
          return (a.salaryMin ?? a.salaryMax ?? Infinity) - (b.salaryMin ?? b.salaryMax ?? Infinity);
        case 'distance': {
          var adist = global.Distance.effectiveDistance(a, homeOverride);
          var bdist = global.Distance.effectiveDistance(b, homeOverride);
          return (adist ?? Infinity) - (bdist ?? Infinity);
        }
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
