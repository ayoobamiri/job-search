(function () {
  'use strict';

  var EDJOIN_SOURCE_ID = 'edjoin';
  var VIEW_IDS = ['view-hub', 'view-source', 'view-districts', 'view-district-detail'];

  // Shared cross-device dismissed-job-ids list, stored via keyvalue.immanuel.co
  // (a free, keyless JSON key-value store -- confirmed to support CORS from
  // this site's origin). Every device that opens the site reads/writes this
  // same list, so a job deleted on one computer disappears everywhere. The
  // app key below is specific to this one list; there's no login involved,
  // so treat it like a shared bookmark rather than a secret.
  var KV_APP_KEY = 'j3phzvnq';
  var KV_ITEM_KEY = 'dismissed-ids';
  var KV_GET_URL = 'https://keyvalue.immanuel.co/api/KeyVal/GetValue/' + KV_APP_KEY + '/' + KV_ITEM_KEY;
  var KV_SET_URL_PREFIX = 'https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/' + KV_APP_KEY + '/' + KV_ITEM_KEY + '/';

  // Legacy per-device list from before cross-device sync existed. Only read
  // once, to migrate any earlier deletions into the shared list.
  var LEGACY_DISMISSED_KEY = 'jobSearchDismissedJobIds';

  var jobsDataCache = null;
  var sourcesCache = null;
  var dismissedIdsCache = new Set();

  // Serializes every read-modify-write against the shared store so two
  // deletes (rapid clicks on this device, or another device's delete
  // arriving around the same time) can never race: a blind "overwrite with
  // whatever this device last saw" was the actual bug -- whichever write
  // landed last won and silently dropped the other one's deletion. Each
  // write in this queue now re-fetches the current server state first and
  // merges into it, so an overlapping delete elsewhere is preserved instead
  // of clobbered.
  var persistQueue = Promise.resolve();

  function loadLegacyDismissedIds() {
    try {
      var raw = localStorage.getItem(LEGACY_DISMISSED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLegacyDismissedIds(ids) {
    try {
      localStorage.setItem(LEGACY_DISMISSED_KEY, JSON.stringify(ids));
    } catch (e) {
      // private browsing / quota / disabled storage -- local mirror just won't persist
    }
  }

  /** Fetches and unwraps the shared list as it currently stands on the
   * server (the service double-JSON-encodes: the HTTP body is a JSON
   * string containing our own JSON-encoded array). Returns [] on any
   * failure or empty/never-set value. */
  function fetchServerDismissedIds() {
    return fetch(KV_GET_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json(); // outer layer
      })
      .then(function (rawValue) {
        if (!rawValue) return [];
        try {
          return JSON.parse(rawValue) || [];
        } catch (e) {
          return [];
        }
      });
  }

  /** Loads the shared dismissed-ids list, merges in any pre-existing
   * per-device list (one-time migration), and populates dismissedIdsCache.
   * Falls back to the legacy per-device list alone if the shared store is
   * unreachable, so the app still works (just without cross-device sync)
   * if that service is ever down. */
  function loadDismissedIds() {
    return fetchServerDismissedIds()
      .then(function (ids) {
        dismissedIdsCache = new Set(ids);

        var legacy = loadLegacyDismissedIds();
        var hasNew = legacy.some(function (id) { return !dismissedIdsCache.has(id); });
        if (hasNew) {
          legacy.forEach(function (id) { dismissedIdsCache.add(id); });
          return persistDismissedIds();
        }
      })
      .catch(function (err) {
        console.warn('[app] could not reach the shared dismissed-jobs list, using this device\'s own list only:', err.message);
        dismissedIdsCache = new Set(loadLegacyDismissedIds());
      });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** One read-merge-write-verify attempt. This store has no compare-and-swap,
   * so two genuinely simultaneous writes (this device and another, both
   * mid-flight at once) can still both read the same stale state and one
   * can overwrite the other -- merging before writing closes most of that
   * window, but not all of it. Re-reading after the write catches the rest:
   * if our own ids are missing from what's actually on the server afterward,
   * someone else's write raced ours, so we merge again and retry. */
  function attemptPersist(retriesLeft) {
    return fetchServerDismissedIds()
      .catch(function () { return []; })
      .then(function (serverIds) {
        var before = dismissedIdsCache.size;
        serverIds.forEach(function (id) { dismissedIdsCache.add(id); });
        var ids = [...dismissedIdsCache];
        saveLegacyDismissedIds(ids);

        var url = KV_SET_URL_PREFIX + encodeURIComponent(JSON.stringify(ids));
        return fetch(url, { method: 'POST', body: '' }).then(function () {
          if (dismissedIdsCache.size !== before && jobsDataCache) {
            renderMeta(jobsDataCache);
            route();
          }
          return fetchServerDismissedIds().catch(function () { return ids; });
        }).then(function (verifyIds) {
          var verifySet = new Set(verifyIds);
          var lost = ids.some(function (id) { return !verifySet.has(id); });
          if (lost && retriesLeft > 0) {
            return sleep(150 + Math.random() * 250).then(function () {
              return attemptPersist(retriesLeft - 1);
            });
          }
        });
      });
  }

  /** Queues a persist attempt so overlapping calls (fast repeated deletes on
   * this device) run one at a time against a fresh read instead of racing
   * on a stale snapshot, then verifies and retries a few times if a
   * concurrent write from elsewhere still raced past that. */
  function persistDismissedIds() {
    persistQueue = persistQueue
      .then(function () { return attemptPersist(3); })
      .catch(function (err) {
        console.warn('[app] could not save the shared dismissed-jobs list (will retry on next delete):', err.message);
      });
    return persistQueue;
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
   * not just the row it was deleted from -- and, since dismissedIdsCache is
   * loaded from the shared store, not on any other device either. */
  function visibleJobs(jobsData) {
    return (jobsData.jobs || []).filter(function (job) { return !dismissedIdsCache.has(job.id); });
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
      dismissedIdsCache.add(id);
      renderMeta(jobsDataCache);
      route();
      persistDismissedIds();
    });

    Promise.all([loadJson('data/jobs.json'), loadJson('data/sources.json'), loadDismissedIds()])
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
