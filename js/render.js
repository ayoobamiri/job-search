/**
 * DOM rendering. All scraped text is escaped before being injected as
 * HTML, since job titles/summaries/employer names originate from external
 * third-party sites.
 */
(function (global) {
  'use strict';

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatSalary(job) {
    if (job.salaryMin != null && job.salaryMax != null) {
      var period = job.salaryPeriod ? '/' + job.salaryPeriod : '';
      if (job.salaryMin === job.salaryMax) {
        return '$' + job.salaryMin.toLocaleString() + period;
      }
      return '$' + job.salaryMin.toLocaleString() + ' – $' + job.salaryMax.toLocaleString() + period;
    }
    return job.salaryText && job.salaryText !== 'Not provided' ? job.salaryText : 'Not provided';
  }

  function formatDate(iso) {
    if (!iso) return null;
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function jobCardHtml(job, homeOverride, isFavorite) {
    var badges = '';
    if (global.Filters.isNewJob(job)) badges += '<span class="badge badge-new">New</span>';
    if (global.Filters.isClosingSoon(job, 7)) badges += '<span class="badge badge-soon">Closing soon</span>';
    if (job.noClosingDate) badges += '<span class="badge badge-nodate">No closing date provided</span>';

    var due = job.noClosingDate ? 'No closing date provided' : (formatDate(job.closingDate) || 'Not provided');
    var distanceMiles = global.Distance.effectiveDistance(job, homeOverride);
    var distanceText = distanceMiles == null ? 'Not provided' : distanceMiles + ' mi';

    return (
      '<article class="job-card" data-job-id="' + escapeHtml(job.id) + '">' +
        '<div class="job-card-top">' +
          '<div>' +
            '<h3 class="job-title">' + escapeHtml(job.title) + '</h3>' +
            '<p class="job-employer">' + escapeHtml(job.employer) + ' — ' + escapeHtml(job.city) + (job.county ? ', ' + escapeHtml(job.county) : '') + '</p>' +
          '</div>' +
          '<button class="favorite-btn' + (isFavorite ? ' active' : '') + '" data-fav-toggle="' + escapeHtml(job.id) + '" title="Save to favorites" aria-label="Save to favorites">' + (isFavorite ? '★' : '☆') + '</button>' +
        '</div>' +
        (badges ? '<div class="badge-row">' + badges + '</div>' : '') +
        '<div class="job-meta-grid">' +
          '<div><span class="label">Salary</span><span class="value">' + escapeHtml(formatSalary(job)) + '</span></div>' +
          '<div><span class="label">Due</span><span class="value">' + escapeHtml(due) + '</span></div>' +
          '<div><span class="label">Employment type</span><span class="value">' + escapeHtml(job.employmentType || 'Not provided') + '</span></div>' +
          '<div><span class="label">Distance</span><span class="value">' + escapeHtml(distanceText) + '</span></div>' +
        '</div>' +
        (job.summary ? '<p class="job-summary">' + escapeHtml(job.summary) + '</p>' : '') +
        '<div class="job-card-footer">' +
          '<span class="job-source"><span class="dot"></span>' + escapeHtml(job.sourceWebsite || job.sourceName) + '</span>' +
          '<a class="apply-link" href="' + escapeHtml(job.applyUrl) + '" target="_blank" rel="noopener noreferrer">View Job / Apply</a>' +
        '</div>' +
      '</article>'
    );
  }

  function statusBannerHtml(jobsData) {
    if (!jobsData.lastUpdated) {
      return '<div class="status-banner warn"><strong>No data yet.</strong>&nbsp;This dashboard has not run a scrape yet. Once the scheduled GitHub Action runs (or you run <code>npm run scrape</code> locally), current job listings will appear here.</div>';
    }
    var errors = (jobsData.sourceRunSummary || []).filter(function (s) { return s.status === 'error'; });
    if (errors.length > 0) {
      var names = errors.map(function (s) { return escapeHtml(s.sourceName); }).join(', ');
      return '<div class="status-banner error"><strong>Some sources failed on the last run:</strong>&nbsp;' + names + '. Showing results from the sources that succeeded.</div>';
    }
    return '';
  }

  global.Render = {
    escapeHtml: escapeHtml,
    formatSalary: formatSalary,
    formatDate: formatDate,
    jobCardHtml: jobCardHtml,
    statusBannerHtml: statusBannerHtml,
  };
})(window);
