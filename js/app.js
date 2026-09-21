(function () {
  'use strict';

  var state = {
    jobsData: { lastUpdated: null, jobs: [], sourceRunSummary: [] },
    counties: [],
  };

  function initTheme() {
    var KEY = 'itjobs.theme';
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-toggle').addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || 'dark';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    });
  }

  function loadJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load ' + path);
      return res.json();
    });
  }

  function loadAll() {
    return Promise.all([
      loadJson('data/jobs.json').catch(function () { return { lastUpdated: null, jobs: [], sourceRunSummary: [] }; }),
      loadJson('data/counties.json').catch(function () { return []; }),
    ]).then(function (results) {
      state.jobsData = results[0];
      state.counties = results[1];
    });
  }

  function readFilters() {
    return {
      keyword: document.getElementById('f-keyword').value.trim(),
      county: document.getElementById('f-county').value,
      sort: document.getElementById('f-sort').value,
    };
  }

  function populateCountyOptions() {
    var select = document.getElementById('f-county');
    var enabled = state.counties.filter(function (c) { return c.enabled; });
    select.innerHTML = '<option value="">All counties</option>' +
      enabled.map(function (c) {
        return '<option value="' + Render.escapeHtml(c.name) + '">' + Render.escapeHtml(c.name) + '</option>';
      }).join('');
  }

  function renderStatusBanner() {
    document.getElementById('status-banner-container').innerHTML = Render.statusBannerHtml(state.jobsData);
  }

  function renderLastUpdated() {
    var el = document.getElementById('last-updated');
    if (!state.jobsData.lastUpdated) {
      el.textContent = 'Never refreshed';
      return;
    }
    var d = new Date(state.jobsData.lastUpdated);
    el.textContent = 'Last refreshed ' + d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderJobGrid() {
    var filters = readFilters();
    var jobs = state.jobsData.jobs || [];
    var filtered = Filters.filterAndSortJobs(jobs, filters);

    document.getElementById('results-count').textContent =
      filtered.length + (filtered.length === 1 ? ' job found' : ' jobs found');

    var grid = document.getElementById('job-grid');

    if (filtered.length === 0) {
      var reason = state.jobsData.lastUpdated
        ? 'Try a different search term or county, or click "Refresh Jobs" to check for newly posted openings.'
        : 'No scrape has run yet. Once the scheduled check runs, matching jobs will show up here.';
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>No IT jobs match right now</h3><p>' + reason + '</p></div>';
      return;
    }

    grid.innerHTML = filtered.map(function (job) {
      return Render.jobCardHtml(job);
    }).join('');
  }

  function refreshView() {
    populateCountyOptions();
    renderStatusBanner();
    renderLastUpdated();
    renderJobGrid();
  }

  function initToolbar() {
    document.getElementById('f-keyword').addEventListener('input', renderJobGrid);
    document.getElementById('f-county').addEventListener('change', renderJobGrid);
    document.getElementById('f-sort').addEventListener('change', renderJobGrid);

    document.getElementById('btn-refresh').addEventListener('click', function () {
      var btn = document.getElementById('btn-refresh');
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      loadJson('data/jobs.json?ts=' + Date.now()).then(function (data) {
        state.jobsData = data;
        refreshView();
      }).catch(function () {
        alert('Could not reload job data. Check your connection and try again.');
      }).finally(function () {
        btn.disabled = false;
        btn.innerHTML = '&#8635; Refresh Jobs';
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initToolbar();

    loadAll().then(function () {
      refreshView();
    }).catch(function (err) {
      console.error(err);
      document.getElementById('job-grid').innerHTML =
        '<div class="empty-state" style="grid-column:1/-1;"><h3>Could not load job data</h3><p>' + Render.escapeHtml(err.message) + '</p></div>';
    });
  });
})();
