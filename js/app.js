(function () {
  'use strict';

  var PAGE_SIZE = 24;

  var state = {
    jobsData: { lastUpdated: null, jobs: [], sourceRunSummary: [] },
    defaultSources: [],
    defaultCounties: [],
    defaultKeywords: [],
    sources: [],   // effective (defaults + overrides)
    counties: [],  // effective
    keywords: [],  // effective
    visibleCount: PAGE_SIZE,
    editingSourceId: null,
  };

  // ---------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------
  function initTheme() {
    var saved = Store.getTheme();
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-toggle').addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || 'dark';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      Store.setTheme(next);
    });
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  function initTabs() {
    var tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
        document.getElementById('view-' + tab.dataset.view).classList.add('active');
      });
    });
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------
  function loadJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load ' + path);
      return res.json();
    });
  }

  function loadAll() {
    return Promise.all([
      loadJson('data/jobs.json').catch(function () { return { lastUpdated: null, jobs: [], sourceRunSummary: [] }; }),
      loadJson('data/sources.json').catch(function () { return []; }),
      loadJson('data/counties.json').catch(function () { return []; }),
      loadJson('data/keywords.json').catch(function () { return []; }),
    ]).then(function (results) {
      state.jobsData = results[0];
      state.defaultSources = results[1];
      state.defaultCounties = results[2];
      state.defaultKeywords = results[3];
      recomputeEffectiveConfig();
    });
  }

  function recomputeEffectiveConfig() {
    state.sources = Store.getSourceOverrides() || state.defaultSources.slice();
    state.counties = Store.getCountyOverrides() || state.defaultCounties.slice();
    state.keywords = Store.getKeywordOverrides() || state.defaultKeywords.slice();
  }

  // ---------------------------------------------------------------------
  // Filter state (read from toolbar)
  // ---------------------------------------------------------------------
  function readFilters() {
    return {
      keyword: document.getElementById('f-keyword').value.trim(),
      county: document.getElementById('f-county').value,
      city: document.getElementById('f-city').value.trim(),
      employer: document.getElementById('f-employer').value.trim(),
      source: document.getElementById('f-source').value,
      employmentType: document.getElementById('f-employment-type').value,
      salaryMin: document.getElementById('f-salary-min').value,
      salaryMax: document.getElementById('f-salary-max').value,
      maxDistance: document.getElementById('f-distance').value,
      deadline: document.getElementById('f-deadline').value,
      sort: document.getElementById('f-sort').value,
      favoritesOnly: document.getElementById('f-favorites-only').checked,
    };
  }

  function applyDefaultPrefsToToolbar() {
    var prefs = Store.getPrefs();
    if (prefs.minSalary != null) document.getElementById('f-salary-min').value = prefs.minSalary;
    if (prefs.maxDistance != null) document.getElementById('f-distance').value = prefs.maxDistance;
  }

  // ---------------------------------------------------------------------
  // Dashboard rendering
  // ---------------------------------------------------------------------
  function jobsFromEnabledSources() {
    var enabledSourceIds = {};
    state.sources.forEach(function (s) { if (s.enabled) enabledSourceIds[s.id] = true; });
    var enabledCountyNames = {};
    state.counties.forEach(function (c) { if (c.enabled) enabledCountyNames[c.name] = true; });

    return (state.jobsData.jobs || []).filter(function (job) {
      return enabledSourceIds[job.sourceId] && enabledCountyNames[job.county];
    });
  }

  function populateSelectOptions() {
    var countySelect = document.getElementById('f-county');
    countySelect.innerHTML = '<option value="">All counties</option>' +
      state.counties.filter(function (c) { return c.enabled; }).map(function (c) {
        return '<option value="' + Render.escapeHtml(c.name) + '">' + Render.escapeHtml(c.name) + '</option>';
      }).join('');

    var sourceSelect = document.getElementById('f-source');
    sourceSelect.innerHTML = '<option value="">All sources</option>' +
      state.sources.filter(function (s) { return s.enabled; }).map(function (s) {
        return '<option value="' + Render.escapeHtml(s.id) + '">' + Render.escapeHtml(s.name) + '</option>';
      }).join('');
  }

  function renderStats(filteredJobs) {
    var allActive = jobsFromEnabledSources();
    document.getElementById('stat-active').textContent = allActive.length;
    document.getElementById('stat-new').textContent = allActive.filter(function (j) { return Filters.isNewJob(j); }).length;
    document.getElementById('stat-closing-soon').textContent = allActive.filter(function (j) { return Filters.isClosingSoon(j, 7); }).length;
    document.getElementById('stat-sources').textContent = state.sources.filter(function (s) { return s.enabled; }).length;
    document.getElementById('stat-counties').textContent = state.counties.filter(function (c) { return c.enabled; }).length;
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
    var homeOverride = Store.getHomeOverride();
    var favorites = Store.getFavorites();

    var pool = jobsFromEnabledSources();
    var filtered = Filters.filterAndSortJobs(pool, filters, homeOverride, favorites);

    renderStats(filtered);
    document.getElementById('results-count').textContent =
      filtered.length + (filtered.length === 1 ? ' job found' : ' jobs found');

    var grid = document.getElementById('job-grid');
    var visible = filtered.slice(0, state.visibleCount);

    if (filtered.length === 0) {
      var reason = state.jobsData.lastUpdated
        ? 'Try widening your filters, or click "Refresh Jobs" to check for newly posted openings.'
        : 'No scrape has run yet. Once GitHub Actions runs the scraper (or you run it locally), matching jobs will show up here.';
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>No jobs match your search</h3><p>' + reason + '</p></div>';
      document.getElementById('load-more-row').style.display = 'none';
      return;
    }

    grid.innerHTML = visible.map(function (job) {
      return Render.jobCardHtml(job, homeOverride, favorites.indexOf(job.id) !== -1);
    }).join('');

    grid.querySelectorAll('[data-fav-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Store.toggleFavorite(btn.dataset.favToggle);
        renderJobGrid();
      });
    });

    document.getElementById('load-more-row').style.display = filtered.length > state.visibleCount ? 'flex' : 'none';
  }

  function refreshDashboard() {
    populateSelectOptions();
    renderStatusBanner();
    renderLastUpdated();
    state.visibleCount = PAGE_SIZE;
    renderJobGrid();
  }

  // ---------------------------------------------------------------------
  // Toolbar wiring
  // ---------------------------------------------------------------------
  function initToolbar() {
    document.getElementById('btn-search').addEventListener('click', function () {
      state.visibleCount = PAGE_SIZE;
      renderJobGrid();
    });

    document.getElementById('btn-refresh').addEventListener('click', function () {
      var btn = document.getElementById('btn-refresh');
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      loadJson('data/jobs.json?ts=' + Date.now()).then(function (data) {
        state.jobsData = data;
        refreshDashboard();
      }).catch(function () {
        alert('Could not reload job data. Check your connection and try again.');
      }).finally(function () {
        btn.disabled = false;
        btn.innerHTML = '&#8635; Refresh Jobs';
      });
    });

    document.getElementById('btn-clear-filters').addEventListener('click', function () {
      ['f-keyword', 'f-city', 'f-employer', 'f-salary-min', 'f-salary-max', 'f-distance'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      ['f-county', 'f-source', 'f-employment-type', 'f-deadline'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      document.getElementById('f-sort').value = 'newest';
      document.getElementById('f-favorites-only').checked = false;
      state.visibleCount = PAGE_SIZE;
      renderJobGrid();
    });

    document.getElementById('f-favorites-only').addEventListener('change', function () {
      state.visibleCount = PAGE_SIZE;
      renderJobGrid();
    });

    document.getElementById('btn-load-more').addEventListener('click', function () {
      state.visibleCount += PAGE_SIZE;
      renderJobGrid();
    });

    // Live search on Enter in the keyword field
    document.getElementById('f-keyword').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { state.visibleCount = PAGE_SIZE; renderJobGrid(); }
    });
  }

  // ---------------------------------------------------------------------
  // My Job Search (settings) view
  // ---------------------------------------------------------------------
  function initSettingsView() {
    var homeOverride = Store.getHomeOverride();
    if (homeOverride) {
      document.getElementById('s-home-lat').value = homeOverride.lat;
      document.getElementById('s-home-lon').value = homeOverride.lon;
    }
    document.getElementById('btn-save-home').addEventListener('click', function () {
      var lat = parseFloat(document.getElementById('s-home-lat').value);
      var lon = parseFloat(document.getElementById('s-home-lon').value);
      if (!isFinite(lat) || !isFinite(lon)) {
        alert('Enter valid latitude and longitude values.');
        return;
      }
      Store.setHomeOverride(lat, lon);
      renderJobGrid();
      alert('Home location saved to this browser.');
    });
    document.getElementById('btn-clear-home').addEventListener('click', function () {
      Store.clearHomeOverride();
      document.getElementById('s-home-lat').value = '';
      document.getElementById('s-home-lon').value = '';
      renderJobGrid();
    });

    var prefs = Store.getPrefs();
    if (prefs.minSalary != null) document.getElementById('s-min-salary').value = prefs.minSalary;
    if (prefs.maxDistance != null) document.getElementById('s-max-distance').value = prefs.maxDistance;
    document.getElementById('btn-save-prefs').addEventListener('click', function () {
      var minSalary = document.getElementById('s-min-salary').value;
      var maxDistance = document.getElementById('s-max-distance').value;
      Store.setPrefs({
        minSalary: minSalary === '' ? null : Number(minSalary),
        maxDistance: maxDistance === '' ? null : Number(maxDistance),
      });
      applyDefaultPrefsToToolbar();
      renderJobGrid();
      alert('Default preferences saved.');
    });

    renderCountyList();
    renderKeywordTags();
    renderSourceChecklist();

    document.getElementById('btn-add-county').addEventListener('click', function () {
      var input = document.getElementById('new-county-name');
      var name = input.value.trim();
      if (!name) return;
      var list = state.counties.slice();
      list.push({ id: name.toLowerCase().replace(/\s+/g, '-'), name: name, enabled: true });
      Store.setCountyOverrides(list);
      recomputeEffectiveConfig();
      input.value = '';
      renderCountyList();
      refreshDashboard();
    });

    document.getElementById('btn-add-keyword').addEventListener('click', function () {
      var input = document.getElementById('new-keyword');
      var kw = input.value.trim();
      if (!kw) return;
      var list = state.keywords.slice();
      if (list.indexOf(kw) === -1) list.push(kw);
      Store.setKeywordOverrides(list);
      recomputeEffectiveConfig();
      input.value = '';
      renderKeywordTags();
    });
  }

  function renderCountyList() {
    var container = document.getElementById('settings-county-list');
    container.innerHTML = state.counties.map(function (c, idx) {
      return (
        '<div class="county-row">' +
          '<label class="switch"><input type="checkbox" data-county-toggle="' + idx + '" ' + (c.enabled ? 'checked' : '') + '><span class="slider"></span></label>' +
          '<input type="text" value="' + Render.escapeHtml(c.name) + '" data-county-name="' + idx + '" />' +
          '<button class="btn btn-sm btn-danger" data-county-remove="' + idx + '">Remove</button>' +
        '</div>'
      );
    }).join('');

    container.querySelectorAll('[data-county-toggle]').forEach(function (el) {
      el.addEventListener('change', function () {
        var idx = Number(el.dataset.countyToggle);
        var list = state.counties.slice();
        list[idx] = Object.assign({}, list[idx], { enabled: el.checked });
        Store.setCountyOverrides(list);
        recomputeEffectiveConfig();
        refreshDashboard();
      });
    });
    container.querySelectorAll('[data-county-name]').forEach(function (el) {
      el.addEventListener('change', function () {
        var idx = Number(el.dataset.countyName);
        var list = state.counties.slice();
        list[idx] = Object.assign({}, list[idx], { name: el.value.trim() });
        Store.setCountyOverrides(list);
        recomputeEffectiveConfig();
        refreshDashboard();
      });
    });
    container.querySelectorAll('[data-county-remove]').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = Number(el.dataset.countyRemove);
        var list = state.counties.slice();
        list.splice(idx, 1);
        Store.setCountyOverrides(list);
        recomputeEffectiveConfig();
        renderCountyList();
        refreshDashboard();
      });
    });
  }

  function renderKeywordTags() {
    var container = document.getElementById('keyword-tags');
    container.innerHTML = state.keywords.map(function (kw, idx) {
      return '<span class="tag-chip">' + Render.escapeHtml(kw) + '<button data-kw-remove="' + idx + '" aria-label="Remove keyword">×</button></span>';
    }).join('');
    container.querySelectorAll('[data-kw-remove]').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = Number(el.dataset.kwRemove);
        var list = state.keywords.slice();
        list.splice(idx, 1);
        Store.setKeywordOverrides(list);
        recomputeEffectiveConfig();
        renderKeywordTags();
      });
    });
  }

  function renderSourceChecklist() {
    var container = document.getElementById('settings-source-checklist');
    container.innerHTML = state.sources.map(function (s) {
      return (
        '<div class="source-check-row">' +
          '<label class="switch"><input type="checkbox" data-source-enable="' + Render.escapeHtml(s.id) + '" ' + (s.enabled ? 'checked' : '') + '><span class="slider"></span></label>' +
          '<span>' + Render.escapeHtml(s.name) + ' <span style="color:var(--text-mute)">(' + Render.escapeHtml(s.website) + ')</span></span>' +
        '</div>'
      );
    }).join('');
    container.querySelectorAll('[data-source-enable]').forEach(function (el) {
      el.addEventListener('change', function () {
        setSourceEnabled(el.dataset.sourceEnable, el.checked);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Sources view (full CRUD)
  // ---------------------------------------------------------------------
  function persistSources(list) {
    state.sources = list;
    Store.setSourceOverrides(list);
  }

  function setSourceEnabled(id, enabled) {
    var list = state.sources.map(function (s) { return s.id === id ? Object.assign({}, s, { enabled: enabled }) : s; });
    persistSources(list);
    renderSourcesTable();
    renderSourceChecklist();
    refreshDashboard();
  }

  function renderSourcesTable() {
    var body = document.getElementById('sources-table-body');
    body.innerHTML = state.sources.map(function (s) {
      return (
        '<tr>' +
          '<td><div class="source-name">' + Render.escapeHtml(s.name) + '</div><div class="source-url">' + Render.escapeHtml(s.website) + '</div></td>' +
          '<td>' + Render.escapeHtml(s.type) + '</td>' +
          '<td class="source-url">' + Render.escapeHtml(s.searchUrl) + '</td>' +
          '<td><label class="switch"><input type="checkbox" data-tbl-enable="' + Render.escapeHtml(s.id) + '" ' + (s.enabled ? 'checked' : '') + '><span class="slider"></span></label></td>' +
          '<td>' +
            '<button class="btn btn-sm" data-edit-source="' + Render.escapeHtml(s.id) + '">Edit</button> ' +
            '<button class="btn btn-sm btn-danger" data-remove-source="' + Render.escapeHtml(s.id) + '">Remove</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');

    body.querySelectorAll('[data-tbl-enable]').forEach(function (el) {
      el.addEventListener('change', function () { setSourceEnabled(el.dataset.tblEnable, el.checked); });
    });
    body.querySelectorAll('[data-edit-source]').forEach(function (el) {
      el.addEventListener('click', function () { openEditSourceModal(el.dataset.editSource); });
    });
    body.querySelectorAll('[data-remove-source]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (!confirm('Remove this source?')) return;
        persistSources(state.sources.filter(function (s) { return s.id !== el.dataset.removeSource; }));
        renderSourcesTable();
        renderSourceChecklist();
        refreshDashboard();
      });
    });
  }

  function initSourcesView() {
    renderSourcesTable();

    document.getElementById('add-source-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('src-name').value.trim();
      var website = document.getElementById('src-website').value.trim();
      var type = document.getElementById('src-type').value;
      var url = document.getElementById('src-url').value.trim();
      if (!name || !website || !url) return;

      var id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
      var newSource = { id: id, name: name, website: website, type: type, searchUrl: url, enabled: true, notes: 'Added via dashboard UI.' };
      persistSources(state.sources.concat([newSource]));
      e.target.reset();
      renderSourcesTable();
      renderSourceChecklist();
      refreshDashboard();
    });

    document.getElementById('btn-export-config').addEventListener('click', exportConfig);
    document.getElementById('import-config-input').addEventListener('change', importConfig);
    document.getElementById('btn-reset-sources').addEventListener('click', function () {
      if (!confirm('Reset sources to the defaults checked into the repo? This clears your local edits.')) return;
      Store.resetSourceOverrides();
      recomputeEffectiveConfig();
      renderSourcesTable();
      renderSourceChecklist();
      refreshDashboard();
    });

    document.getElementById('btn-save-edit-source').addEventListener('click', saveEditSourceModal);
    document.getElementById('btn-cancel-edit-source').addEventListener('click', closeEditSourceModal);
  }

  function openEditSourceModal(id) {
    var source = state.sources.find(function (s) { return s.id === id; });
    if (!source) return;
    state.editingSourceId = id;
    document.getElementById('edit-src-name').value = source.name;
    document.getElementById('edit-src-website').value = source.website;
    document.getElementById('edit-src-type').value = source.type;
    document.getElementById('edit-src-url').value = source.searchUrl;
    document.getElementById('edit-source-modal').style.display = 'flex';
  }

  function closeEditSourceModal() {
    document.getElementById('edit-source-modal').style.display = 'none';
    state.editingSourceId = null;
  }

  function saveEditSourceModal() {
    var id = state.editingSourceId;
    if (!id) return;
    var updated = {
      name: document.getElementById('edit-src-name').value.trim(),
      website: document.getElementById('edit-src-website').value.trim(),
      type: document.getElementById('edit-src-type').value,
      searchUrl: document.getElementById('edit-src-url').value.trim(),
    };
    persistSources(state.sources.map(function (s) { return s.id === id ? Object.assign({}, s, updated) : s; }));
    closeEditSourceModal();
    renderSourcesTable();
    renderSourceChecklist();
    refreshDashboard();
  }

  function exportConfig() {
    var payload = JSON.stringify(state.sources, null, 2);
    var blob = new Blob([payload], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'sources.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importConfig(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error('Expected an array of sources');
        persistSources(parsed);
        renderSourcesTable();
        renderSourceChecklist();
        refreshDashboard();
        alert('Sources imported into this browser.');
      } catch (err) {
        alert('Could not import file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initTabs();
    initToolbar();

    loadAll().then(function () {
      applyDefaultPrefsToToolbar();
      populateSelectOptions();
      initSettingsView();
      initSourcesView();
      refreshDashboard();
      Store.setLastVisit(new Date().toISOString());
    }).catch(function (err) {
      console.error(err);
      document.getElementById('job-grid').innerHTML =
        '<div class="empty-state" style="grid-column:1/-1;"><h3>Could not load job data</h3><p>' + Render.escapeHtml(err.message) + '</p></div>';
    });
  });
})();
