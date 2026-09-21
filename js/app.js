(function () {
  'use strict';

  function loadJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load ' + path);
      return res.json();
    });
  }

  function groupBySource(jobs) {
    var groups = new Map();
    jobs.forEach(function (job) {
      var key = job.sourceName || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(job);
    });
    return [...groups.entries()].sort(function (a, b) { return a[0].localeCompare(b[0]); });
  }

  function sourceSectionHtml(sourceName, jobs) {
    var count = jobs.length + (jobs.length === 1 ? ' job' : ' jobs');
    return (
      '<section class="source-section">' +
        '<h2 class="source-heading">' + Render.escapeHtml(sourceName) + ' <span class="source-count">(' + count + ')</span></h2>' +
        '<div class="job-grid">' + jobs.map(Render.jobCardHtml).join('') + '</div>' +
      '</section>'
    );
  }

  function render(jobsData) {
    document.getElementById('status-banner-container').innerHTML = Render.statusBannerHtml(jobsData);

    var lastUpdatedEl = document.getElementById('last-updated');
    lastUpdatedEl.textContent = jobsData.lastUpdated
      ? 'Last refreshed ' + new Date(jobsData.lastUpdated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
      : 'Never refreshed';

    var jobs = Filters.filterAndSortJobs(jobsData.jobs || []);
    document.getElementById('results-count').textContent =
      jobs.length + (jobs.length === 1 ? ' job found' : ' jobs found');

    var container = document.getElementById('job-sections');
    if (jobs.length === 0) {
      var reason = jobsData.lastUpdated
        ? 'No IT-related openings in the target counties right now. Check back after the next scheduled refresh.'
        : 'No scrape has run yet. Once the scheduled check runs, matching jobs will show up here.';
      container.innerHTML = '<div class="empty-state"><h3>No IT jobs right now</h3><p>' + reason + '</p></div>';
      return;
    }

    container.innerHTML = groupBySource(jobs)
      .map(function (entry) { return sourceSectionHtml(entry[0], entry[1]); })
      .join('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadJson('data/jobs.json')
      .then(render)
      .catch(function (err) {
        console.error(err);
        document.getElementById('job-sections').innerHTML =
          '<div class="empty-state"><h3>Could not load job data</h3><p>' + Render.escapeHtml(err.message) + '</p></div>';
      });
  });
})();
