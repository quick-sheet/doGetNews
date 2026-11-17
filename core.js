/* doGet(news): logic with no page in it, so it can be tested with plain node. */
(function (root) {
  'use strict';
  const H = 3600e3, DAY = 864e5;

  const TRACKS = [
    { id: 'all', n: 'All' },
    { id: 'ws', n: 'Workspace' },
    { id: 'cloud', n: 'Cloud' },
    { id: 'ai', n: 'AI' },
    { id: 'dev', n: 'Dev tools' },
  ];
  const TRACK_NAME = { ws: 'Workspace', cloud: 'Cloud', ai: 'AI', dev: 'Dev tools' };
  const STAGES = { model: 'New model', ga: 'GA', preview: 'Preview', deprecated: 'Deprecated', breaking: 'Breaking change' };
  const READ = { gcp: 'Read the release note', gemapi: 'Read the release note', ws: 'Read the update' };

  // Checks and tidies a brief.json. Returns null when it isn't one.
  function prepare(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return null;
    const ok = (x) => x && typeof x.id === 'string' && typeof x.t === 'string' && typeof x.u === 'string' && /^https:\/\//.test(x.u) && isFinite(x.d);
    const items = raw.items.filter(ok).map((x) => Object.assign({ s: '', p: [], st: '', r: 10, a: x.d, tr: 'cloud' }, x));
    items.sort((a, b) => b.d - a.d || b.r - a.r);
    const videos = {}, articles = {};
    (raw.videos || []).filter(ok).forEach((v) => { videos[v.id] = v; });
    (raw.articles || []).filter(ok).forEach((v) => { articles[v.id] = v; });
    let minA = Infinity, maxA = 0;
    items.forEach((x) => { if (x.a < minA) minA = x.a; if (x.a > maxA) maxA = x.a; });
    const sources = Array.isArray(raw.sources) ? raw.sources : [];
    const srcName = {};
    sources.forEach((s) => { srcName[s.id] = s.n; });
    return {
      generated: +raw.generated || maxA || 0,
      keepDays: raw.keepDays || 14,
      items, videos, articles, sources, srcName,
      firstRun: !items.length || maxA - minA < H,   // everything arrived in one run
      latestRun: maxA,
    };
  }

  /* ---------- Dates ---------- */
  const dayKey = (ms) => { const d = new Date(ms); return d.getFullYear() * 1e4 + (d.getMonth() + 1) * 100 + d.getDate(); };
  function dayLabel(ms, now) {
    const k = dayKey(ms);
    if (k === dayKey(now)) return 'Today';
    if (k === dayKey(now - DAY)) return 'Yesterday';
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const longDate = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const shortDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  let h12 = false;
  try { h12 = !!new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12; } catch (e) { /* keep 24 h */ }
  const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit' });

  function ago(ms, now) {
    const m = Math.round((now - ms) / 60e3);
    if (m < 2) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24);
    return d === 1 ? '1 day ago' : d + ' days ago';
  }
  // "Updated at 07:04 today", "Updated yesterday at 07:04", "Updated on Sunday at 07:04", "Updated 9 days ago"
  function updatedTxt(gen, now) {
    if (!gen) return '';
    const k = dayKey(gen);
    if (k === dayKey(now)) return 'Updated at ' + time(gen) + ' today';
    if (k === dayKey(now - DAY)) return 'Updated yesterday at ' + time(gen);
    if (now - gen < 6 * DAY) return 'Updated on ' + new Date(gen).toLocaleDateString(undefined, { weekday: 'long' }) + ' at ' + time(gen);
    return 'Updated ' + ago(gen, now);
  }
  // A brief more than 30 hours old means a daily run was missed
  const isStale = (gen, now) => !!gen && now - gen > 30 * H;

  /* ---------- Choosing what to show ---------- */
  function words(q) { return String(q || '').toLowerCase().split(/\s+/).filter(Boolean); }
  function haystack(it, srcName) {
    return [it.t, it.s, (it.p || []).join(' '), it.g || '', TRACK_NAME[it.tr] || '', STAGES[it.st] || '', (srcName && srcName[it.src]) || '', it.ch || '', it.by || ''].join(' ').toLowerCase();
  }
  function matches(it, q, srcName) {
    const w = words(q);
    if (!w.length) return true;
    const h = haystack(it, srcName);
    return w.every((x) => h.indexOf(x) >= 0);
  }
  // f: { track, hidden: { ws: true }, quiet, q, onlyNew, since, srcName }
  function filter(items, f) {
    f = f || {};
    return items.filter((it) => {
      if (f.track && f.track !== 'all' && it.tr !== f.track) return false;
      if ((!f.track || f.track === 'all') && f.hidden && f.hidden[it.tr]) return false;
      if (f.quiet && it.src === 'gcp' && !it.st) return false;
      if (f.onlyNew && !isNew(it, f.since)) return false;
      return matches(it, f.q, f.srcName);
    });
  }
  const isNew = (it, since) => since != null && it.a > since;
  const newCount = (items, since) => (since == null ? 0 : items.filter((it) => isNew(it, since)).length);

  // Newest day first; within a day the most important first
  function group(list, now, when) {
    when = when || ((x) => x.d);
    const days = [];
    const byKey = {};
    list.forEach((it) => {
      const k = dayKey(when(it));
      if (!byKey[k]) { byKey[k] = { key: k, ms: when(it), label: dayLabel(when(it), now), items: [] }; days.push(byKey[k]); }
      byKey[k].items.push(it);
    });
    days.sort((a, b) => b.key - a.key);
    days.forEach((d) => d.items.sort((a, b) => (b.r || 0) - (a.r || 0) || when(b) - when(a)));
    return days;
  }

  // The hero: the most important update from the latest run, or from the newest day when
  // everything arrived at once (the very first brief) or nothing new arrived
  function topPick(list, brief) {
    if (!list.length) return null;
    let pool = brief && !brief.firstRun ? list.filter((x) => x.a >= brief.latestRun - H) : [];
    if (!pool.length) { const k = dayKey(list[0].d); pool = list.filter((x) => dayKey(x.d) === k); }
    if (!pool.length) pool = list;
    return pool.slice().sort((a, b) => b.r - a.r || b.d - a.d)[0];
  }

  function stats(list) {
    const s = { n: list.length, model: 0, ga: 0, preview: 0, deprecated: 0 };
    list.forEach((x) => {
      if (x.st === 'model') s.model++;
      else if (x.st === 'ga') s.ga++;
      else if (x.st === 'preview') s.preview++;
      else if (x.st === 'deprecated' || x.st === 'breaking') s.deprecated++;
    });
    return s;
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  // "1 new model, 3 now GA, 2 deprecations"
  function statsTxt(s) {
    const bits = [];
    if (s.model) bits.push(plural(s.model, 'new model', 'new models'));
    if (s.ga) bits.push(s.ga + ' now GA');
    if (s.preview) bits.push(s.preview + ' in preview');
    if (s.deprecated) bits.push(plural(s.deprecated, 'deprecation', 'deprecations'));
    return bits.join(', ');
  }

  function readLabel(it) { return READ[it.src] || 'Read the post'; }

  /* ---------- Links ---------- */
  // In the installed Android app, a link opens in Chrome (or the YouTube app) rather than inside
  // the app's own window. Links with #anchors stay plain, because an intent link can't carry one.
  function extHref(url, ctx) {
    if (!(ctx && ctx.android && ctx.standalone)) return url;
    let u;
    try { u = new URL(url); } catch (e) { return url; }
    if (u.protocol !== 'https:' || u.hash) return url;
    const yt = /(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === 'youtu.be';
    const pkg = yt ? 'com.google.android.youtube' : 'com.android.chrome';
    return 'intent://' + u.host + u.pathname + u.search + '#Intent;scheme=https;package=' + pkg + ';S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
  }
  const isIntent = (href) => /^intent:/.test(href);
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  const thumb = (id) => 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/mqdefault.jpg';

  const Core = {
    TRACKS, TRACK_NAME, STAGES, prepare, dayKey, dayLabel, longDate, shortDate, time, ago, updatedTxt, isStale,
    matches, filter, isNew, newCount, group, topPick, stats, statsTxt, plural, readLabel, extHref, isIntent, hostOf, thumb,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
