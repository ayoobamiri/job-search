/**
 * localStorage-backed settings store. Nothing here is ever sent anywhere —
 * it only lives in this browser. Used to layer per-visitor preferences
 * (favorites, enabled sources/counties/keywords, home-location override)
 * on top of the checked-in defaults fetched from data/*.json.
 */
(function (global) {
  'use strict';

  var PREFIX = 'itjobs.';

  function get(key, fallback) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (err) {
      console.warn('Could not save setting "' + key + '":', err);
    }
  }

  function remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (err) { /* ignore */ }
  }

  var Store = {
    // Theme
    getTheme: function () { return get('theme', null); },
    setTheme: function (t) { set('theme', t); },

    // Favorites: array of job ids
    getFavorites: function () { return get('favorites', []); },
    toggleFavorite: function (jobId) {
      var favs = Store.getFavorites();
      var idx = favs.indexOf(jobId);
      if (idx === -1) favs.push(jobId); else favs.splice(idx, 1);
      set('favorites', favs);
      return favs;
    },
    isFavorite: function (jobId) { return Store.getFavorites().indexOf(jobId) !== -1; },

    // Home location override (client-side only distance recompute)
    getHomeOverride: function () { return get('homeOverride', null); },
    setHomeOverride: function (lat, lon) { set('homeOverride', { lat: lat, lon: lon }); },
    clearHomeOverride: function () { remove('homeOverride'); },

    // Counties: null = use defaults from data/counties.json
    getCountyOverrides: function () { return get('counties', null); },
    setCountyOverrides: function (list) { set('counties', list); },

    // Keywords: null = use defaults from data/keywords.json
    getKeywordOverrides: function () { return get('keywords', null); },
    setKeywordOverrides: function (list) { set('keywords', list); },

    // Sources: null = use defaults from data/sources.json
    getSourceOverrides: function () { return get('sources', null); },
    setSourceOverrides: function (list) { set('sources', list); },
    resetSourceOverrides: function () { remove('sources'); },

    // Default search preferences
    getPrefs: function () { return get('prefs', { minSalary: null, maxDistance: null }); },
    setPrefs: function (prefs) { set('prefs', prefs); },

    // Last-viewed timestamp, used to compute "new since you last visited"
    getLastVisit: function () { return get('lastVisit', null); },
    setLastVisit: function (iso) { set('lastVisit', iso); },
  };

  global.Store = Store;
})(window);
