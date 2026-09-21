(function () {
  'use strict';

  function loadJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load ' + path);
      return res.json();
    });
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

    var grid = document.getElementById('job-grid');
    if (jobs.length === 0) {
      var reason = jobsData.lastUpdated
        ? 'No IT-related openings in the target counties right now. Check back after the next scheduled refresh.'
        : 'No scrape has run yet. Once the scheduled check runs, matching jobs will show up here.';
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>No IT jobs right now</h3><p>' + reason + '</p></div>';
      return;
    }

    grid.innerHTML = jobs.map(Render.jobCardHtml).join('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadJson('data/jobs.json')
      .then(render)
      .catch(function (err) {
        console.error(err);
        document.getElementById('job-grid').innerHTML =
          '<div class="empty-state" style="grid-column:1/-1;"><h3>Could not load job data</h3><p>' + Render.escapeHtml(err.message) + '</p></div>';
      });
  });
})();
