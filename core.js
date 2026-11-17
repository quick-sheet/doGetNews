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
  const TRACK_NAME = { ws: 'GWS', cloud: 'GCP', ai: 'AI', dev: 'Dev tools' };
  const TRACK_WORDS = { ws: 'GWS Google Workspace', cloud: 'GCP Google Cloud', ai: 'AI', dev: 'Dev tools developer' };

  // Topics to follow. An update belongs to a topic by its track, its source, or one of its products.
  // Choosing none means everything.
  const GOOGLE_APPS = ['Gmail', 'Google Drive', 'Google Docs', 'Google Sheets', 'Google Slides', 'Google Meet', 'Google Chat',
    'Google Calendar', 'Google Forms', 'Google Vids', 'Google Keep', 'Google Sites', 'Google Classroom', 'Gemini in Workspace'];
  const TOPICS = [
    { id: 'gcp', n: 'GCP', g: 'Platforms', tr: 'cloud', src: ['gcp', 'cloudblog'] },
    { id: 'gws', n: 'GWS', g: 'Platforms', tr: 'ws', src: ['ws', 'kwws', 'wsdev'] },
    { id: 'apps', n: 'Google Apps', g: 'Platforms', p: GOOGLE_APPS },
    { id: 'gemx', n: 'Gemini Enterprise', g: 'AI', p: ['Agent Platform', 'Gemini Enterprise'] },
    { id: 'aistudio', n: 'Google AI Studio', g: 'AI', p: ['Google AI Studio', 'Gemini API'] },
    { id: 'ai', n: 'Gemini & AI', g: 'AI', tr: 'ai' },
    { id: 'antigravity', n: 'Google Antigravity', g: 'Build', p: ['Google Antigravity'] },
    { id: 'appsscript', n: 'Apps Script', g: 'Build', p: ['Apps Script'] },
    { id: 'appsheet', n: 'AppSheet', g: 'Build', p: ['AppSheet'] },
    { id: 'firebase', n: 'Firebase', g: 'Build', p: ['Firebase', 'Firebase Studio', 'Genkit'] },
    { id: 'firestore', n: 'Firestore', g: 'Build', p: ['Firestore'] },
    { id: 'bigquery', n: 'BigQuery', g: 'Build', p: ['BigQuery'] },
    { id: 'dev', n: 'Dev tools', g: 'Build', tr: 'dev' },
  ];
  const TOPIC = {};
  TOPICS.forEach((t) => { TOPIC[t.id] = t; });
  const TOPIC_GROUPS = ['Platforms', 'AI', 'Build'];
  // v1 tracks become the matching topic
  const FROM_TRACK = { ws: 'gws', cloud: 'gcp', ai: 'ai', dev: 'dev' };

  function inTopic(it, t) {
    if (!t) return false;
    if (t.tr && it.tr === t.tr) return true;
    if (t.src && t.src.indexOf(it.src) >= 0) return true;
    return !!t.p && (it.p || []).some((n) => t.p.indexOf(n) >= 0);
  }
  // sel: topic ids; none chosen means all
  function inTopics(it, sel) {
    if (!sel || !sel.length) return true;
    return sel.some((id) => inTopic(it, TOPIC[id]));
  }
  function topicCounts(items) {
    const out = {};
    TOPICS.forEach((t) => { out[t.id] = 0; });
    items.forEach((it) => TOPICS.forEach((t) => { if (inTopic(it, t)) out[t.id]++; }));
    return out;
  }
  const cleanTopics = (sel) => (Array.isArray(sel) ? sel.filter((id, i) => TOPIC[id] && sel.indexOf(id) === i) : []);
  const STAGES = { model: 'New model', ga: 'GA', preview: 'Preview', deprecated: 'Deprecated', breaking: 'Breaking change' };
  const READ = { gcp: 'Read the release note', gemapi: 'Read the release note', asnotes: 'Read the release note', wsdev: 'Read the release note',
    antigravity: 'Read the changelog', appsheet: 'Read the release note', ws: 'Read the update' };

  const ok = (x) => x && typeof x.id === 'string' && typeof x.t === 'string' && typeof x.u === 'string' && /^https:\/\//.test(x.u) && isFinite(x.d);
  const tidy = (x) => Object.assign({ s: '', p: [], st: '', r: 10, a: x.d, tr: 'cloud' }, x);

  // Checks and tidies a brief.json. Returns null when it isn't one.
  function prepare(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return null;
    const items = raw.items.filter(ok).map(tidy);
    items.sort((a, b) => b.d - a.d || b.r - a.r);
    const videos = {}, articles = {};
    (raw.videos || []).filter(ok).forEach((v) => { videos[v.id] = v; });
    (raw.articles || []).filter(ok).forEach((v) => { articles[v.id] = v; });
    let minA = Infinity, maxA = 0;
    items.forEach((x) => { if (x.a < minA) minA = x.a; if (x.a > maxA) maxA = x.a; });
    const sources = Array.isArray(raw.sources) ? raw.sources : [];
    const srcName = {};
    sources.forEach((s) => { srcName[s.id] = s.n; });
    const arch = raw.archive && typeof raw.archive.file === 'string' && /^[\w.-]+\.json$/.test(raw.archive.file) ? raw.archive : null;
    return {
      generated: +raw.generated || maxA || 0,
      keepDays: raw.keepDays || 14,
      historyDays: raw.historyDays || raw.keepDays || 14,
      archive: arch ? { file: arch.file, items: +arch.items || 0, loaded: false } : null,
      items, videos, articles, sources, srcName,
      firstRun: !items.length || maxA - minA < H,   // everything arrived in one run
      latestRun: maxA,
    };
  }

  // Adds archive.json (the older part of the three months) to a prepared brief. An archive from a day
  // either side is fine (the two files are saved moments apart, and an update is only ever kept once);
  // an older one is left out. Returns how many updates it added, or -1 when it isn't an archive.
  function mergeArchive(b, raw) {
    if (!b || !raw || raw.v !== 1 || !Array.isArray(raw.items)) return -1;
    if (b.generated && raw.generated && Math.abs(+raw.generated - b.generated) > 3 * DAY) return -1;
    const have = {};
    b.items.forEach((x) => { have[x.id] = 1; });
    const add = raw.items.filter((x) => ok(x) && !have[x.id]).map(tidy);
    b.items = b.items.concat(add).sort((x, y) => y.d - x.d || y.r - x.r);
    (raw.videos || []).filter(ok).forEach((v) => { if (!b.videos[v.id]) b.videos[v.id] = v; });
    (raw.articles || []).filter(ok).forEach((v) => { if (!b.articles[v.id]) b.articles[v.id] = v; });
    if (b.archive) b.archive.loaded = true;
    return add.length;
  }

  // When: Today, Yesterday, This week (from Monday), This month (from the 1st), All. Days are the phone's own.
  const PERIODS = [
    { id: 'today', n: 'Today', from: 'today' }, { id: 'yesterday', n: 'Yesterday', from: 'yesterday' },
    { id: 'week', n: 'This week', from: 'this week' }, { id: 'month', n: 'This month', from: 'this month' }, { id: 'all', n: 'All', from: 'the last three months' },
  ];
  // { from, to } in ms for a period, or null for All
  function periodRange(id, now) {
    const d = new Date(now), y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    const start = new Date(y, m, day).getTime();
    if (id === 'today') return { from: start, to: Infinity };
    if (id === 'yesterday') return { from: new Date(y, m, day - 1).getTime(), to: start };
    if (id === 'week') return { from: new Date(y, m, day - (d.getDay() + 6) % 7).getTime(), to: Infinity };
    if (id === 'month') return { from: new Date(y, m, 1).getTime(), to: Infinity };
    return null;
  }
  const inRange = (it, r) => !r || (it.d >= r.from && it.d < r.to);
  function periodCounts(items, now) {
    const out = {};
    PERIODS.forEach((p) => { const r = periodRange(p.id, now); out[p.id] = items.filter((it) => inRange(it, r)).length; });
    return out;
  }
  const cleanPeriod = (id) => (PERIODS.some((p) => p.id === id) ? id : 'all');


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
    return [it.t, it.s, (it.p || []).join(' '), it.g || '', TRACK_WORDS[it.tr] || '', STAGES[it.st] || '', (srcName && srcName[it.src]) || '', it.ch || '', it.by || ''].join(' ').toLowerCase();
  }
  function matches(it, q, srcName) {
    const w = words(q);
    if (!w.length) return true;
    const h = haystack(it, srcName);
    return w.every((x) => h.indexOf(x) >= 0);
  }
  // f: { topics: ['gcp'], range: periodRange(...), track, hidden: { ws: true }, quiet, q, onlyNew, since, srcName }
  function filter(items, f) {
    f = f || {};
    return items.filter((it) => {
      if (f.topics && !inTopics(it, f.topics)) return false;
      if (f.range && !inRange(it, f.range)) return false;
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
    TRACKS, TRACK_NAME, STAGES, TOPICS, TOPIC, TOPIC_GROUPS, FROM_TRACK, inTopic, inTopics, topicCounts, cleanTopics, mergeArchive,
    PERIODS, periodRange, inRange, periodCounts, cleanPeriod,
    prepare, dayKey, dayLabel, longDate, shortDate, time, ago, updatedTxt, isStale,
    matches, filter, isNew, newCount, group, topPick, stats, statsTxt, plural, readLabel, extHref, isIntent, hostOf, thumb,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
