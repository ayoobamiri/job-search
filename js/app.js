(function () {
  'use strict';

  var EDJOIN_SOURCE_ID = 'edjoin';
  var VIEW_IDS = ['view-hub', 'view-source', 'view-districts', 'view-district-detail'];
  var DISMISSED_KEY = 'jobSearchDismissedJobIds';

  var jobsDataCache = null;
  var sourcesCache = null;

  function loadDismissedIds() {
    try {
      var raw = localStorage.getItem(DISMISSED_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
      return new Set();
    }
  }

  function saveDismissedIds(ids) {
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
    } catch (e) {
      // private browsing / quota / disabled storage -- deletion just won't persist
    }
  }

  /** Soonest due date first; jobs with no closing date sort to the end
   * (newest-first among themselves), since they have no real deadline. */
  function sortByDueDate(jobs) {
    return jobs.slice().sort(function (a, b) {
      if (a.closingDate && b.closingDate) return new Date(a.closingDate) - new Date(b.closingDate);
      if (a.closingDate && !b.closingDate) return -1;
      if (!a.closingDate && b.closingDate) return 1;
      return new Date(b.firstSeen || 0) - new Date(a.firstSeen || 0);
    });
  }

  /** Jobs the viewer hasn't dismissed. Applied everywhere (cards, counts,
   * the table) so a deleted job never reappears anywhere in the app,
   * not just the row it was deleted from. */
  function visibleJobs(jobsData) {
    var dismissed = loadDismissedIds();
    return (jobsData.jobs || []).filter(function (job) { return !dismissed.has(job.id); });
  }

  function loadJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load ' + path);
      return res.json();
    });
  }

  function showView(id) {
    VIEW_IDS.forEach(function (v) {
      document.getElementById(v).classList.toggle('hidden', v !== id);
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

  function groupByDistrict(jobs) {
    var groups = new Map();
    jobs
      .filter(function (job) { return job.sourceId === EDJOIN_SOURCE_ID; })
      .forEach(function (job) {
        var key = job.employer || 'Unknown district';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(job);
      });
    return groups;
  }

  function countCardHtml(href, name, subtitle, count, ctaText) {
    var countLabel = count === 1 ? 'job open' : 'jobs open';
    return (
      '<a class="source-card" href="' + href + '">' +
        '<div class="source-card-top">' +
          '<h2 class="source-card-name">' + Render.escapeHtml(name) + '</h2>' +
          (subtitle ? '<p class="source-card-website">' + Render.escapeHtml(subtitle) + '</p>' : '') +
        '</div>' +
        '<div class="source-card-count">' +
          '<span class="count-num">' + count + '</span>' +
          '<span class="count-label">' + countLabel + '</span>' +
        '</div>' +
        '<span class="source-card-cta">' + ctaText + '</span>' +
      '</a>'
    );
  }

  function renderHub(jobsData, sources) {
    showView('view-hub');

    var jobs = visibleJobs(jobsData);
    var grouped = groupBySourceId(jobs);
    var cards = sources.map(function (source) {
      var count = (grouped.get(source.id) || []).length;
      return countCardHtml('#/source/' + encodeURIComponent(source.id), source.name, source.website, count, 'View jobs &rarr;');
    });

    var edjoinJobCount = (grouped.get(EDJOIN_SOURCE_ID) || []).length;
    var districtCount = groupByDistrict(jobs).size;
    cards.push(countCardHtml(
      '#/districts',
      'School Districts',
      'Grouped from EDJOIN.org',
      edjoinJobCount,
      districtCount + (districtCount === 1 ? ' district &rarr;' : ' districts &rarr;')
    ));

    document.getElementById('source-grid').innerHTML = cards.join('');

    var tableJobs = sortByDueDate(jobs);
    document.getElementById('jobs-table-body').innerHTML = tableJobs.map(Render.jobRowHtml).join('');
  }

  function renderSourceDetail(jobsData, sources, sourceId) {
    showView('view-source');

    var source = sources.find(function (s) { return s.id === sourceId; });
    var heading = document.getElementById('source-detail-heading');
    var container = document.getElementById('source-jobs');

    if (!source) {
      heading.textContent = 'Source not found';
      container.innerHTML = '<div class="empty-state"><h3>Unknown source</h3><p><a href="#/">Back to all sources</a></p></div>';
      return;
    }

    var jobs = Filters.filterAndSortJobs(visibleJobs(jobsData).filter(function (job) {
      return job.sourceId === sourceId;
    }));

    heading.textContent = source.name + ' — ' + jobs.length + (jobs.length === 1 ? ' job open' : ' jobs open');

    if (jobs.length === 0) {
      container.innerHTML = '<div class="empty-state"><h3>No open IT jobs right now</h3><p>Check back after the next scheduled refresh.</p></div>';
      return;
    }
    container.innerHTML = jobs.map(Render.jobCardHtml).join('');
  }

  function renderDistrictList(jobsData) {
    showView('view-districts');

    var grouped = groupByDistrict(visibleJobs(jobsData));
    var names = [...grouped.keys()].sort(function (a, b) { return a.localeCompare(b); });
    var grid = document.getElementById('district-grid');

    if (names.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No open IT jobs from school districts right now</h3><p>Check back after the next scheduled refresh.</p></div>';
      return;
    }

    grid.innerHTML = names
      .map(function (name) {
        var count = grouped.get(name).length;
        return countCardHtml('#/districts/' + encodeURIComponent(name), name, null, count, 'View jobs &rarr;');
      })
      .join('');
  }

  function renderDistrictDetail(jobsData, districtName) {
    showView('view-district-detail');

    var jobs = Filters.filterAndSortJobs(visibleJobs(jobsData).filter(function (job) {
      return job.sourceId === EDJOIN_SOURCE_ID && job.employer === districtName;
    }));

    var heading = document.getElementById('district-detail-heading');
    var container = document.getElementById('district-jobs');

    if (jobs.length === 0) {
      heading.textContent = districtName;
      container.innerHTML = '<div class="empty-state"><h3>No open IT jobs right now</h3><p><a href="#/districts">Back to all districts</a></p></div>';
      return;
    }

    heading.textContent = districtName + ' — ' + jobs.length + (jobs.length === 1 ? ' job open' : ' jobs open');
    container.innerHTML = jobs.map(Render.jobCardHtml).join('');
  }

  function route() {
    if (!jobsDataCache || !sourcesCache) return;
    var hash = window.location.hash || '';
    var sourceMatch = hash.match(/^#\/source\/(.+)$/);
    var districtMatch = hash.match(/^#\/districts\/(.+)$/);

    if (sourceMatch) {
      renderSourceDetail(jobsDataCache, sourcesCache, decodeURIComponent(sourceMatch[1]));
    } else if (districtMatch) {
      renderDistrictDetail(jobsDataCache, decodeURIComponent(districtMatch[1]));
    } else if (hash === '#/districts') {
      renderDistrictList(jobsDataCache);
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

    var jobs = visibleJobs(jobsData);
    document.getElementById('results-count').textContent =
      jobs.length + (jobs.length === 1 ? ' job found' : ' jobs found');
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.addEventListener('click', function (e) {
      var btn = e.target.closest('.job-delete-btn');
      if (!btn || !jobsDataCache) return;
      var id = btn.getAttribute('data-delete-id');
      var dismissed = loadDismissedIds();
      dismissed.add(id);
      saveDismissedIds(dismissed);
      renderMeta(jobsDataCache);
      route();
    });

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
