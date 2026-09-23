(function () {
  'use strict';

  var jobsDataCache = null;
  var sourcesCache = null;

  function loadJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load ' + path);
      return res.json();
    });
  }

  function groupBySourceId(jobs) {
    var groups = new Map();
    jobs.forEach(function (job) {
      var key = job.sourceId || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(job);
    });
    return groups;
  }

  function sourceCardHtml(source, count) {
    var countLabel = count === 1 ? 'job open' : 'jobs open';
    return (
      '<a class="source-card" href="#/source/' + encodeURIComponent(source.id) + '">' +
        '<div class="source-card-top">' +
          '<h2 class="source-card-name">' + Render.escapeHtml(source.name) + '</h2>' +
          '<p class="source-card-website">' + Render.escapeHtml(source.website) + '</p>' +
        '</div>' +
        '<div class="source-card-count">' +
          '<span class="count-num">' + count + '</span>' +
          '<span class="count-label">' + countLabel + '</span>' +
        '</div>' +
        '<span class="source-card-cta">View jobs &rarr;</span>' +
      '</a>'
    );
  }

  function renderHub(jobsData, sources) {
    document.getElementById('view-source').classList.add('hidden');
    document.getElementById('view-hub').classList.remove('hidden');

    var grouped = groupBySourceId(jobsData.jobs || []);
    var grid = document.getElementById('source-grid');
    grid.innerHTML = sources
      .map(function (source) {
        var count = (grouped.get(source.id) || []).length;
        return sourceCardHtml(source, count);
      })
      .join('');
  }

  function renderSourceDetail(jobsData, sources, sourceId) {
    document.getElementById('view-hub').classList.add('hidden');
    document.getElementById('view-source').classList.remove('hidden');

    var source = sources.find(function (s) { return s.id === sourceId; });
    var heading = document.getElementById('source-detail-heading');
    var container = document.getElementById('source-jobs');

    if (!source) {
      heading.textContent = 'Source not found';
      container.innerHTML = '<div class="empty-state"><h3>Unknown source</h3><p><a href="#/">Back to all sources</a></p></div>';
      return;
    }

    var jobs = Filters.filterAndSortJobs((jobsData.jobs || []).filter(function (job) {
      return job.sourceId === sourceId;
    }));

    heading.textContent = source.name + ' — ' + jobs.length + (jobs.length === 1 ? ' job open' : ' jobs open');

    if (jobs.length === 0) {
      container.innerHTML = '<div class="empty-state"><h3>No open IT jobs right now</h3><p>Check back after the next scheduled refresh.</p></div>';
      return;
    }
    container.innerHTML = jobs.map(Render.jobCardHtml).join('');
  }

  function route() {
    if (!jobsDataCache || !sourcesCache) return;
    var match = (window.location.hash || '').match(/^#\/source\/(.+)$/);
    if (match) {
      renderSourceDetail(jobsDataCache, sourcesCache, decodeURIComponent(match[1]));
    } else {
      renderHub(jobsDataCache, sourcesCache);
    }
  }

  function renderMeta(jobsData) {
    document.getElementById('status-banner-container').innerHTML = Render.statusBannerHtml(jobsData);

    var lastUpdatedEl = document.getElementById('last-updated');
    lastUpdatedEl.textContent = jobsData.lastUpdated
      ? 'Last refreshed ' + new Date(jobsData.lastUpdated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
      : 'Never refreshed';

    var jobs = jobsData.jobs || [];
    document.getElementById('results-count').textContent =
      jobs.length + (jobs.length === 1 ? ' job found' : ' jobs found');
  }

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([loadJson('data/jobs.json'), loadJson('data/sources.json')])
      .then(function (results) {
        jobsDataCache = results[0];
        sourcesCache = results[1].filter(function (s) { return s.enabled; });
        renderMeta(jobsDataCache);
        route();
        window.addEventListener('hashchange', route);
      })
      .catch(function (err) {
        console.error(err);
        document.getElementById('view-hub').innerHTML =
          '<div class="empty-state"><h3>Could not load job data</h3><p>' + Render.escapeHtml(err.message) + '</p></div>';
      });
  });
})();
