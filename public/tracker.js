/*
 * © 2026 gamer-09. All rights reserved.
 * This code is proprietary. Unauthorized copying, modification,
 * distribution, or use of this software is strictly prohibited.
 */
/* ==========================================================================
   Visitor Tracking — lightweight, privacy-friendly, no external deps.
   Counts page views & unique visitors in localStorage.
   Auto-injects a floating counter badge if no #visitorCount element exists.
   ========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'site_stats';
  var FP_KEY = 'site_fp';

  function getFingerprint() {
    var s = sessionStorage.getItem(FP_KEY);
    if (s) return s;
    var raw = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height, screen.colorDepth, new Date().getTimezoneOffset()].join('|');
    var h = 0;
    for (var i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
    var fp = 'v_' + Math.abs(h).toString(36);
    sessionStorage.setItem(FP_KEY, fp);
    return fp;
  }

  function getStats() {
    try { var r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function saveStats(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {} }

  function init() {
    var s = getStats();
    if (!s) s = { views: 0, visitors: [], first: new Date().toISOString(), last: null };
    var fp = getFingerprint();
    s.views++;
    s.last = new Date().toISOString();
    if (s.visitors.indexOf(fp) === -1) s.visitors.push(fp);
    saveStats(s);
    return s;
  }

  function fmt(n) { return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n); }

  var stats = init();

  // Update existing counter if present
  var el = document.getElementById('visitorCount');
  if (el) el.textContent = fmt(stats.views);

  // Auto-inject floating badge if no counter element found
  if (!el) {
    var badge = document.createElement('div');
    badge.id = 'visitor-badge';
    badge.innerHTML = '<span style="opacity:0.7">👁️</span> <strong style="color:#ff6b35">' + fmt(stats.views) + '</strong> <span style="opacity:0.5;font-size:0.7em">views</span>';
    badge.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;background:rgba(15,15,25,0.85);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.08);border-radius:100px;padding:6px 14px;font-family:system-ui,sans-serif;font-size:13px;color:#e2e8f0;display:flex;align-items:center;gap:6px;pointer-events:none;';
    document.body.appendChild(badge);
  }

  // Expose API for custom tracking
  window.SiteTrack = {
    getStats: function () { return getStats(); }
  };
})();
