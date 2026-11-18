/**
 * doGet(news) · the once-a-day Apps Script run.
 *
 * Reads Google's own feeds (Cloud, Workspace, Apps Script and AppSheet release notes, update blogs,
 * the Gemini API and Antigravity changelogs, official YouTube channels and the Google Cloud Community
 * on Medium), tags each update by track, product and stage, matches videos and tutorials to it, and
 * saves two files into the GitHub repo that hosts the app: brief.json (the last two weeks, so the
 * app opens fast) and archive.json (the rest of the three months, which the app loads after).
 *
 * There is no web app here and no doGet: nothing outside can call this script.
 * It runs twice a day from time triggers (about 7am and 7pm UK time), so the app can never cause extra runs.
 * Most of Google's posts go out in US working hours: the morning run catches the end of the US day, and the
 * evening run its morning, so Today fills the same day.
 *
 * One-off setup: Project Settings → Script Properties → GITHUB_TOKEN, then run setup().
 */

const BUILD = 10;

const CONFIG = {
  repo: 'quick-sheet/doGetNews',
  branch: 'main',
  file: 'brief.json',      // the last two weeks: small, so the app opens fast
  archive: 'archive.json', // the rest of the three months, loaded by the app in the background
  recentDays: 14,
  keepDays: 90,            // updates, videos and articles stay for three months
  mediaDays: 90,
  maxItems: 4000,
  maxVideos: 600,
  maxArticles: 300,
  maxPerDayDevNotes: 10,
  maxPerDayChangelog: 8,
  summaryChars: 280,
  hours: [7, 19],      // the brief runs between 7 and 8am, and between 7 and 8pm, UK time
};

// Every source is an official Google page or feed, except Medium, which carries the Google Cloud
// Community publication (articles by Googlers and Google Developer Experts).
const SOURCES = [
  { id: 'gcp', name: 'Google Cloud release notes', kind: 'gcpnotes', track: 'cloud',
    url: 'https://docs.cloud.google.com/feeds/gcp-release-notes.xml', home: 'https://docs.cloud.google.com/release-notes' },
  { id: 'ws', name: 'Google Workspace Updates', kind: 'feed', track: 'ws',
    url: 'https://workspaceupdates.googleblog.com/feeds/posts/default', home: 'https://workspaceupdates.googleblog.com/' },
  // The Markdown copy of the release notes: the web page now opens inside AI Studio, which builds it in the browser.
  // If that copy has gone, AI Studio's own Markdown copy is tried next.
  { id: 'gemapi', name: 'Gemini API release notes', kind: 'changelog', track: 'ai', product: 'Gemini API',
    url: 'https://ai.google.dev/gemini-api/docs/changelog.md.txt', alt: 'https://aistudio.google.com/docs/changelog.md',
    home: 'https://ai.google.dev/gemini-api/docs/changelog' },
  { id: 'cloudblog', name: 'Google Cloud blog', kind: 'feed', track: 'cloud',
    url: 'https://cloudblog.withgoogle.com/rss/', home: 'https://cloud.google.com/blog' },
  { id: 'devblog', name: 'Google Developers Blog', kind: 'feed', track: 'dev',
    url: 'https://developers.googleblog.com/rss/', home: 'https://developers.googleblog.com/' },
  { id: 'kwai', name: 'The Keyword: AI', kind: 'feed', track: 'ai',
    url: 'https://blog.google/technology/ai/rss/', home: 'https://blog.google/technology/ai/' },
  { id: 'kwgemini', name: 'The Keyword: Gemini', kind: 'feed', track: 'ai',
    url: 'https://blog.google/products/gemini/rss/', home: 'https://blog.google/products/gemini/' },
  { id: 'kwdev', name: 'The Keyword: Developer tools', kind: 'feed', track: 'dev',
    url: 'https://blog.google/innovation-and-ai/technology/developers-tools/rss/', home: 'https://blog.google/innovation-and-ai/technology/developers-tools/' },
  { id: 'kwws', name: 'The Keyword: Workspace', kind: 'feed', track: 'ws',
    url: 'https://blog.google/products/workspace/rss/', home: 'https://blog.google/products/workspace/' },
  { id: 'deepmind', name: 'Google DeepMind', kind: 'feed', track: 'ai',
    url: 'https://deepmind.google/blog/feed', home: 'https://deepmind.google/blog/' },
  { id: 'asnotes', name: 'Apps Script release notes', kind: 'devfeed', track: 'dev', product: 'Apps Script',
    url: 'https://developers.google.com/feeds/apps-script-release-notes.xml', home: 'https://developers.google.com/apps-script/releases' },
  { id: 'wsdev', name: 'Google Workspace developer release notes', kind: 'devfeed', track: 'dev', product: 'Workspace APIs',
    url: 'https://developers.google.com/feeds/workspace-release-notes.xml', home: 'https://developers.google.com/workspace/release-notes' },
  { id: 'firebase', name: 'Firebase blog', kind: 'feed', track: 'dev', product: 'Firebase',
    url: 'https://firebase.blog/rss.xml', home: 'https://firebase.blog/' },
  { id: 'appsheet', name: 'AppSheet release notes', kind: 'forum', track: 'dev', product: 'AppSheet',
    url: 'https://discuss.google.dev/c/appsheet/appsheet-release-notes/123.rss', home: 'https://discuss.google.dev/c/appsheet/appsheet-release-notes/123' },
  { id: 'appsheetnews', name: 'AppSheet announcements', kind: 'forum', track: 'dev', product: 'AppSheet',
    url: 'https://discuss.google.dev/c/appsheet/appsheet-announcements/124.rss', home: 'https://discuss.google.dev/c/appsheet/appsheet-announcements/124' },
  { id: 'antigravity', name: 'Google Antigravity changelog', kind: 'mdlog', track: 'dev', product: 'Google Antigravity',
    url: 'https://antigravity.google/docs/changelog.md', home: 'https://antigravity.google/changelog' },
  { id: 'medium', name: 'Google Cloud Community on Medium', kind: 'article',
    url: 'https://medium.com/feed/google-cloud', home: 'https://medium.com/google-cloud' },
  // YouTube: the UULF playlist is a channel's uploads without Shorts; the plain channel feed is the fallback.
  // expect: the channel name must match, so a wrong ID can never bring in someone else's videos.
  { id: 'yt-cloudtech', name: 'Google Cloud Tech', kind: 'video', channel: 'UCJS9pqu9BzkAMNTmzNMNhvg', expect: 'cloud tech' },
  { id: 'yt-devs', name: 'Google for Developers', kind: 'video', channel: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', expect: 'developers' },
  { id: 'yt-workspace', name: 'Google Workspace', kind: 'video', channel: 'UCBmwzQnSoj9b6HzNmFrg_yw', expect: 'workspace' },
  { id: 'yt-firebase', name: 'Firebase', kind: 'video', channel: 'UCP4bf6IHJJQehibu6ai__cg', expect: 'firebase' },
  { id: 'yt-deepmind', name: 'Google DeepMind', kind: 'video', channel: 'UCP7jMXSY2xbc3KCAE0MHQ-A', expect: 'deepmind' },
];

// Products, most specific first. t: track (ws, cloud, ai, dev). slug: docs.cloud.google.com path.
// broad: an umbrella name that only counts when nothing more specific is found.
const PRODUCTS = [
  // AI
  { n: 'Agent Platform', t: 'ai', re: '\\bgemini enterprise agent platform\\b|\\bagent platform\\b|\\bvertex ai\\b|\\bagent engine\\b|\\bagent studio\\b|\\bagent designer\\b|\\bagent builder\\b|\\bmodel garden\\b|\\bgenerative ai on vertex' },
  { n: 'Gemini Enterprise', t: 'ai', re: '\\bgemini enterprise\\b|\\bagentspace\\b' },
  { n: 'Gemini API', t: 'ai', re: '\\bgemini api\\b|\\binteractions api\\b|\\blive api\\b|\\bgemini-api\\b', docs: 'https://ai.google.dev/gemini-api/docs' },
  { n: 'Google AI Studio', t: 'ai', re: '\\bai studio\\b', docs: 'https://aistudio.google.com/' },
  { n: 'Gemma', t: 'ai', re: '\\b(?:med|code|shield|diffusion |embedding)?gemma\\b', docs: 'https://ai.google.dev/gemma' },
  { n: 'Veo', t: 'ai', re: '\\bveo\\b' },
  { n: 'Imagen', t: 'ai', re: '\\bimagen\\b' },
  { n: 'Lyria', t: 'ai', re: '\\blyria\\b' },
  { n: 'Nano Banana', t: 'ai', re: '\\bnano banana\\b' },
  { n: 'NotebookLM', t: 'ai', re: '\\bnotebooklm\\b', docs: 'https://notebooklm.google/' },
  { n: 'Gemini models', t: 'ai', re: '\\bgemini[ -]\\d+(?:\\.\\d+)?\\b|\\bgemini (?:pro|flash|flash-lite|ultra|nano|omni|live)\\b' },
  // Dev tools
  { n: 'Google Antigravity', t: 'dev', re: '\\bantigravity\\b', docs: 'https://antigravity.google/' },
  { n: 'Gemini CLI', t: 'dev', re: '\\bgemini cli\\b', docs: 'https://github.com/google-gemini/gemini-cli' },
  { n: 'Gemini Code Assist', t: 'dev', re: '\\bcode assist\\b' },
  { n: 'Jules', t: 'dev', re: '\\bjules\\b', docs: 'https://jules.google/' },
  { n: 'Agent Development Kit', t: 'dev', re: '\\bagent development kit\\b|\\badk\\b', docs: 'https://google.github.io/adk-docs/' },
  { n: 'A2A', t: 'dev', re: '\\bagent2agent\\b|\\ba2a\\b' },
  { n: 'Firebase Studio', t: 'dev', re: '\\bfirebase studio\\b', docs: 'https://firebase.studio/' },
  { n: 'Genkit', t: 'dev', re: '\\bgenkit\\b', docs: 'https://genkit.dev/' },
  { n: 'Firebase', t: 'dev', re: '\\bfirebase\\b|\\bcrashlytics\\b', docs: 'https://firebase.google.com/docs' },
  { n: 'Apps Script', t: 'dev', re: '\\bapps script\\b', docs: 'https://developers.google.com/apps-script' },
  { n: 'AppSheet', t: 'dev', re: '\\bappsheet\\b', docs: 'https://support.google.com/appsheet' },
  { n: 'Workspace APIs', t: 'dev', re: '\\bworkspace (?:add-ons?|apis?|developers?|events api)\\b|\\b(?:gmail|drive|sheets|docs|slides|calendar|chat|meet|forms) api\\b|\\bchat apps?\\b|\\badmin sdk\\b|\\bworkspace marketplace\\b', docs: 'https://developers.google.com/workspace' },
  { n: 'Colab', t: 'dev', re: '\\bcolab\\b', docs: 'https://colab.research.google.com/' },
  // Workspace
  { n: 'Gemini in Workspace', t: 'ws', re: '\\bgemini (?:in|for) (?:google )?(?:workspace|gmail|docs|sheets|slides|meet|drive|chat|vids|calendar|forms)\\b|\\bgemini side ?panel\\b' },
  { n: 'Workspace Studio', t: 'ws', re: '\\bworkspace studio\\b|\\bworkspace flows\\b|\\bgoogle flows\\b' },
  { n: 'Gmail', t: 'ws', re: '\\bgmail\\b', docs: 'https://support.google.com/mail' },
  { n: 'Google Drive', t: 'ws', re: '\\bgoogle drive\\b|\\bshared drives?\\b|\\bdrive for desktop\\b', docs: 'https://support.google.com/drive' },
  { n: 'Google Docs', t: 'ws', re: '\\bgoogle docs\\b', docs: 'https://support.google.com/docs' },
  { n: 'Google Sheets', t: 'ws', re: '\\b(?:google )?sheets\\b', docs: 'https://support.google.com/docs' },
  { n: 'Google Slides', t: 'ws', re: '\\bgoogle slides\\b', docs: 'https://support.google.com/docs' },
  { n: 'Google Meet', t: 'ws', re: '\\bgoogle meet\\b|\\bmeet (?:rooms?|hardware|recordings?|calls?|meetings?|transcripts?)\\b|\\bin meet\\b', docs: 'https://support.google.com/meet' },
  { n: 'Google Chat', t: 'ws', re: '\\bgoogle chat\\b', docs: 'https://support.google.com/chat' },
  { n: 'Google Calendar', t: 'ws', re: '\\bgoogle calendar\\b', docs: 'https://support.google.com/calendar' },
  { n: 'Google Forms', t: 'ws', re: '\\bgoogle forms\\b' },
  { n: 'Google Vids', t: 'ws', re: '\\bgoogle vids\\b|\\bvids\\b' },
  { n: 'Google Keep', t: 'ws', re: '\\bgoogle keep\\b' },
  { n: 'Google Sites', t: 'ws', re: '\\bgoogle sites\\b' },
  { n: 'Google Classroom', t: 'ws', re: '\\bclassroom\\b' },
  { n: 'Admin console', t: 'ws', re: '\\badmin console\\b', docs: 'https://support.google.com/a' },
  // Cloud
  { n: 'BigQuery', t: 'cloud', slug: 'bigquery', re: '\\bbigquery\\b' },
  { n: 'Cloud Run', t: 'cloud', slug: 'run', re: '\\bcloud run\\b' },
  { n: 'GKE', t: 'cloud', slug: 'kubernetes-engine', re: '\\bgke\\b|\\bgoogle kubernetes engine\\b' },
  { n: 'Compute Engine', t: 'cloud', slug: 'compute', re: '\\bcompute engine\\b' },
  { n: 'Cloud Storage', t: 'cloud', slug: 'storage', re: '\\bcloud storage\\b' },
  { n: 'Cloud SQL', t: 'cloud', slug: 'sql', re: '\\bcloud sql\\b' },
  { n: 'AlloyDB', t: 'cloud', slug: 'alloydb', re: '\\balloydb\\b' },
  { n: 'Spanner', t: 'cloud', slug: 'spanner', re: '\\bspanner\\b' },
  { n: 'Firestore', t: 'cloud', slug: 'firestore', re: '\\bfirestore\\b' },
  { n: 'Looker', t: 'cloud', slug: 'looker', re: '\\blooker(?: studio)?\\b' },
  { n: 'Dataflow', t: 'cloud', slug: 'dataflow', re: '\\bdataflow\\b' },
  { n: 'Pub/Sub', t: 'cloud', slug: 'pubsub', re: '\\bpub\\/sub\\b|\\bpubsub\\b' },
  { n: 'Dataplex', t: 'cloud', slug: 'dataplex', re: '\\bdataplex\\b' },
  { n: 'Cloud Run functions', t: 'cloud', slug: 'functions', re: '\\bcloud (?:run )?functions\\b' },
  { n: 'Apigee', t: 'cloud', slug: 'apigee', re: '\\bapigee\\b' },
  { n: 'Security Command Center', t: 'cloud', slug: 'security-command-center', re: '\\bsecurity command center\\b' },
  { n: 'IAM', t: 'cloud', slug: 'iam', re: '\\biam\\b|\\bidentity and access management\\b' },
  { n: 'Cloud TPU', t: 'cloud', slug: 'tpu', re: '\\btpus?\\b' },
  { n: 'Cloud Build', t: 'cloud', slug: 'build', re: '\\bcloud build\\b' },
  { n: 'Artifact Registry', t: 'cloud', slug: 'artifact-registry', re: '\\bartifact registry\\b' },
  { n: 'Gemini Cloud Assist', t: 'cloud', re: '\\bcloud assist\\b' },
  // Umbrellas: only used when nothing more specific matched
  { n: 'Google Workspace', t: 'ws', broad: true, re: '\\bworkspace\\b' },
  { n: 'Google Cloud', t: 'cloud', broad: true, re: '\\bgoogle cloud\\b|\\bgcp\\b' },
  { n: 'Gemini', t: 'ai', broad: true, re: '\\bgemini\\b' },
  { n: 'Google DeepMind', t: 'ai', broad: true, re: '\\bdeepmind\\b' },
];
PRODUCTS.forEach((p) => { p.rx = new RegExp(p.re, 'i'); });
const PRODUCT_BY_NAME = {};
PRODUCTS.forEach((p) => { PRODUCT_BY_NAME[p.n.toLowerCase()] = p; });

const DAY = 864e5;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/* ======================================================================
   Entry points (run these from the editor)
   ====================================================================== */

// Run once (and again after changing the times): makes the triggers, then publishes the brief straight away.
function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'daily' || t.getHandlerFunction() === 'learn')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  CONFIG.hours.forEach((h) => ScriptApp.newTrigger('daily').timeBased().everyDays(1).atHour(h).nearMinute(0)
    .inTimezone('Europe/London').create());
  ScriptApp.newTrigger('learn').timeBased().everyDays(1).atHour(LEARN.hour).nearMinute(LEARN.minute)
    .inTimezone('Europe/London').create();
  const at = CONFIG.hours.map((h) => (h % 12 || 12) + (h < 12 ? 'am' : 'pm')).join(' and ');
  console.log('Triggers set: Learn at about 6:30am, and the brief at about ' + at + ' UK time. Publishing the brief now; run learn once to fill Learn straight away.');
  return daily();
}

// The daily run. The trigger calls this; you can also run it by hand from the editor.
function daily() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { console.log('Another run is already going. Nothing to do.'); return null; }
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  try {
    const token = (props.getProperty('GITHUB_TOKEN') || '').trim();
    if (!token) throw new Error('No GitHub token yet. Add GITHUB_TOKEN under Project Settings → Script Properties, then run setup again.');
    const prev = readPrevious(token);
    const fetched = fetchSources();
    const brief = buildBrief(prev.brief, fetched, Date.now());
    const parts = splitBrief(brief);
    const json = JSON.stringify(parts.recent);
    // The archive first, so the brief that points to it is never ahead of it
    publishBrief(token, JSON.stringify(parts.archive), prev.archiveSha, brief.generated, CONFIG.archive);
    publishBrief(token, json, prev.sha, brief.generated, CONFIG.file);
    const ok = brief.sources.filter((s) => s.ok).length;
    const summary = { at: Date.now(), ok: true, items: brief.items.length, recent: parts.recent.items.length, videos: brief.videos.length, articles: brief.articles.length,
      sources: ok + ' of ' + brief.sources.length, kb: Math.round(json.length / 1024), archiveKb: Math.round(JSON.stringify(parts.archive).length / 1024), ms: Date.now() - started };
    props.setProperty('LAST_RUN', JSON.stringify(summary));
    console.log('Published: ' + summary.items + ' updates over three months (' + summary.recent + ' in the last two weeks), ' + summary.videos + ' videos, ' + summary.articles + ' articles. Sources working: ' + summary.sources + '. ' + summary.kb + ' KB brief, ' + summary.archiveKb + ' KB archive.');
    brief.sources.filter((s) => !s.ok).forEach((s) => console.warn(s.n + ': ' + s.e));
    return summary;
  } catch (err) {
    const msg = String((err && err.message) || err);
    props.setProperty('LAST_RUN', JSON.stringify({ at: Date.now(), ok: false, err: msg }));
    console.error(msg);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// Builds a brief from today's feeds and logs what it found, without saving anything to GitHub.
function preview() {
  const brief = buildBrief(null, fetchSources(), Date.now());
  brief.sources.forEach((s) => console.log((s.ok ? 'OK    ' : 'FAIL  ') + s.n + (s.ok ? ': ' + s.c : ': ' + s.e)));
  brief.items.slice(0, 15).forEach((it) => console.log('[' + it.tr + '] ' + (it.st ? it.st + ' · ' : '') + it.t));
  const parts = splitBrief(brief);
  console.log(brief.items.length + ' updates, ' + brief.videos.length + ' videos, ' + brief.articles.length + ' articles. ' + Math.round(JSON.stringify(parts.recent).length / 1024) + ' KB brief, ' + Math.round(JSON.stringify(parts.archive).length / 1024) + ' KB archive.');
  return { items: brief.items.length, videos: brief.videos.length, articles: brief.articles.length };
}

/* ======================================================================
   Fetching
   ====================================================================== */

function sourceUrl(s, attempt) {
  if (s.kind !== 'video') return attempt && s.alt ? s.alt : s.url;
  return attempt === 0
    ? 'https://www.youtube.com/feeds/videos.xml?playlist_id=UULF' + s.channel.slice(2)
    : 'https://www.youtube.com/feeds/videos.xml?channel_id=' + s.channel;
}

// Fetches every source in parallel, then retries the ones that failed once.
function fetchSources() {
  const out = {};
  const req = (s, attempt) => ({ url: sourceUrl(s, attempt), muteHttpExceptions: true, followRedirects: true,
    headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' } });
  const run = (list, attempt) => {
    let res = [];
    try { res = UrlFetchApp.fetchAll(list.map((s) => req(s, attempt))); }
    catch (e) {
      // One bad address can fail the whole batch: fetch them one at a time instead
      res = list.map((s) => { try { const o = req(s, attempt), u = o.url; delete o.url; return UrlFetchApp.fetch(u, o); } catch (e2) { return null; } });
    }
    list.forEach((s, i) => {
      const r = res[i];
      let code = 0, text = '';
      if (r) { code = r.getResponseCode(); try { text = r.getContentText('UTF-8'); } catch (e) { text = ''; } }
      // A changelog with no dates in it (an app shell, say) counts as a miss, so the second address gets a turn
      const why = code >= 200 && code < 300 && s.kind === 'changelog' && !DATE_RE.test(text) ? 'no dated headings found' : '';
      const good = code >= 200 && code < 300 && text.length > 0 && (s.kind !== 'video' || /<entry\b/i.test(text)) && !why;
      if (good || !out[s.id] || (!out[s.id].ok && !out[s.id].why)) out[s.id] = { ok: good, code, text: good ? text : '', why };
    });
  };
  run(SOURCES, 0);
  const failed = SOURCES.filter((s) => !out[s.id].ok);
  if (failed.length) run(failed, 1);
  return out;
}

/* ======================================================================
   Building the brief (pure: takes text in, returns data out)
   ====================================================================== */

function buildBrief(prev, fetched, now) {
  const statuses = [];
  let items = [], videos = [], articles = [];
  for (const s of SOURCES) {
    const f = fetched[s.id];
    const st = { id: s.id, n: s.name, k: s.kind, h: s.home || ('https://www.youtube.com/channel/' + s.channel), ok: false, c: 0, e: '' };
    statuses.push(st);
    if (!f || !f.ok) { st.e = f && f.why ? 'could not be read (' + f.why + ')' : f && f.code ? 'answered ' + f.code : 'could not be reached'; continue; }
    try {
      let got;
      if (s.kind === 'gcpnotes') got = parseGcpNotes(parseFeed(f.text), s, now);
      else if (s.kind === 'changelog') got = parseChangelog(f.text, s, now);
      else if (s.kind === 'devfeed') got = parseDevFeed(parseFeed(f.text), s, now);
      else if (s.kind === 'mdlog') got = parseMdLog(f.text, s, now);
      else if (s.kind === 'forum') got = parseForum(parseFeed(f.text), s, now);
      else if (s.kind === 'video') got = parseVideos(parseFeed(f.text), s, now);
      else if (s.kind === 'article') got = parseArticles(parseFeed(f.text), s, now);
      else got = parseBlog(parseFeed(f.text), s, now);
      if (s.kind === 'video') videos = videos.concat(got);
      else if (s.kind === 'article') articles = articles.concat(got);
      else items = items.concat(got);
      st.ok = true;
      st.c = got.length;
    } catch (err) {
      st.e = 'could not be read (' + String((err && err.message) || err).slice(0, 80) + ')';
    }
  }

  // Carry forward: keep what earlier runs found (so a feed that fails one day loses nothing),
  // keep each update's first-seen time, and let fresh copies replace old ones.
  const keepFrom = now - CONFIG.keepDays * DAY, mediaFrom = now - CONFIG.mediaDays * DAY;
  const old = prev && prev.v === 1 ? prev : null;
  const firstSeen = {};
  if (old) (old.items || []).forEach((it) => { firstSeen[it.id] = it.a; });
  items.forEach((it) => { it.a = firstSeen[it.id] || now; });
  if (old) {
    const have = {};
    items.forEach((it) => { have[it.id] = 1; });
    (old.items || []).forEach((it) => { if (!have[it.id]) items.push(stripMatches(it)); });
    videos = mergeById(videos, old.videos || []);
    articles = mergeById(articles, old.articles || []);
  }
  items = dedupe(items).filter((it) => it.d >= keepFrom && it.d <= now + DAY);
  videos = videos.filter((v) => v.d >= mediaFrom).sort((a, b) => b.d - a.d).slice(0, CONFIG.maxVideos);
  articles = articles.filter((v) => v.d >= mediaFrom).sort((a, b) => b.d - a.d).slice(0, CONFIG.maxArticles);

  // Keep the most important when there are too many, then sort newest first
  if (items.length > CONFIG.maxItems) {
    items.sort((a, b) => b.r - a.r || b.d - a.d);
    items = items.slice(0, CONFIG.maxItems);
  }
  items.sort((a, b) => b.d - a.d || b.r - a.r);

  matchMedia(items, videos, 'v');
  matchMedia(items, articles, 'ar');

  return { v: 1, build: BUILD, generated: now, keepDays: CONFIG.recentDays, historyDays: CONFIG.keepDays, sources: statuses, items, videos, articles };
}

// Two files: brief.json holds the last two weeks so the app opens fast; archive.json holds the rest
function splitBrief(b) {
  const cut = b.generated - CONFIG.recentDays * DAY;
  const recent = (x) => x.d >= cut;
  const older = (x) => x.d < cut;
  const head = Object.assign({}, b, { items: b.items.filter(recent), videos: b.videos.filter(recent), articles: b.articles.filter(recent),
    archive: { file: CONFIG.archive, items: b.items.filter(older).length } });
  const archive = { v: 1, generated: b.generated, items: b.items.filter(older), videos: b.videos.filter(older), articles: b.articles.filter(older) };
  return { recent: head, archive };
}

function stripMatches(it) { const c = Object.assign({}, it); delete c.v; delete c.ar; return c; }
function mergeById(fresh, old) {
  const seen = {};
  const out = [];
  fresh.concat(old).forEach((x) => { if (!seen[x.id]) { seen[x.id] = 1; out.push(x); } });
  return out;
}

// The same story often appears in two feeds (The Keyword AI and Gemini, say). Keep one.
// Release-note sources share one page between many notes, so only their ids count.
const NOTE_KINDS = { gcpnotes: 1, changelog: 1, devfeed: 1, mdlog: 1 };
const NOTE_SOURCES = {};
SOURCES.forEach((s) => { if (NOTE_KINDS[s.kind]) NOTE_SOURCES[s.id] = 1; });
function dedupe(items) {
  const byUrl = {}, byTitle = {}, ids = {}, out = [];
  items.slice().sort((a, b) => b.r - a.r || a.a - b.a).forEach((it) => {
    if (ids[it.id]) return;
    ids[it.id] = 1;
    const note = NOTE_SOURCES[it.src];
    if (note) {
      const nk = it.src + '|' + Math.floor(it.d / DAY) + '|' + normTitle(it.t) + '|' + normTitle(it.s).slice(0, 60);
      if (ids[nk]) return;
      ids[nk] = 1;
    }
    const uk = note ? null : normUrl(it.u);
    const tk = note ? null : normTitle(it.t);
    if ((uk && byUrl[uk]) || (tk && tk.length > 12 && byTitle[tk])) return;
    if (uk) byUrl[uk] = 1;
    if (tk) byTitle[tk] = 1;
    out.push(it);
  });
  return out;
}
function normUrl(u) {
  return String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}
function normTitle(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

/* ---------- XML and HTML helpers ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', eacute: 'é', times: '×', rarr: '→' };
function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e.charAt(0) === '#') {
      const n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const k = e.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
  });
}
function cdata(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); }
// The inside of an element as HTML: CDATA is taken as it is, escaped HTML is unescaped
function inner(raw) { return /<!\[CDATA\[/.test(raw || '') ? cdata(raw) : decode(raw); }
function stripTags(html) {
  return decode(String(html || '')
    .replace(/<(script|style|figure|figcaption)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:a|code|strong|em|b|i|u|span|sup|sub|abbr|mark|small|var|kbd|devsite-[a-z-]+)\b[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|div|tr|ul|ol|blockquote|pre|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ​]+/g, ' ')
    .replace(/ +([,.;:!?)])/g, '$1')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}
function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function textOf(raw) { return oneLine(stripTags(inner(raw))); }

function tagText(block, names) {
  for (let i = 0; i < names.length; i++) {
    const re = new RegExp('<' + names[i] + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + names[i] + '>', 'i');
    const m = re.exec(block);
    if (m) return m[1];
  }
  return '';
}
function linkOf(block) {
  const alt = /<link\b[^>]*\brel=["']alternate["'][^>]*>/i.exec(block)
    || /<link\b(?![^>]*\brel=["'](?:self|replies|edit|enclosure|hub|related)["'])[^>]*\bhref=["'][^"']+["'][^>]*>/i.exec(block);
  if (alt) {
    const h = /\bhref=["']([^"']+)["']/i.exec(alt[0]);
    if (h) return decode(h[1]).trim();
  }
  const t = tagText(block, ['link']);
  if (t && /https?:/.test(t)) return decode(cdata(t)).trim();
  const g = tagText(block, ['guid']);
  const gu = decode(cdata(g)).trim();
  return /^https?:\/\//.test(gu) ? gu : '';
}
function parseDate(raw) {
  const s = decode(cdata(raw)).trim();
  if (!s) return 0;
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}
function categories(block) {
  const out = [];
  let m;
  const a = /<category\b[^>]*\bterm=["']([^"']+)["'][^>]*>/gi;
  while ((m = a.exec(block))) out.push(decode(m[1]));
  const b = /<category\b[^>]*>([\s\S]*?)<\/category>/gi;
  while ((m = b.exec(block))) { const v = oneLine(decode(cdata(m[1]))); if (v) out.push(v); }
  return out;
}

// Reads RSS 2.0 and Atom alike
function parseFeed(xml) {
  xml = String(xml || '');
  const cut = xml.search(/<(?:entry|item)\b/i);
  const head = cut < 0 ? xml : xml.slice(0, cut);
  const feed = {
    title: textOf(tagText(head, ['title'])),
    author: textOf(tagText(tagText(head, ['author']), ['name'])),
    entries: [],
  };
  const re = /<(entry|item)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[2];
    const authorBlock = tagText(b, ['author']);
    feed.entries.push({
      title: textOf(tagText(b, ['title'])),
      link: linkOf(b),
      date: parseDate(tagText(b, ['published', 'pubDate', 'dc:date', 'updated'])),
      html: inner(tagText(b, ['content:encoded', 'content', 'description', 'summary'])),
      cats: categories(b),
      author: textOf(tagText(authorBlock, ['name'])) || textOf(tagText(b, ['dc:creator'])) || textOf(authorBlock),
      videoId: textOf(tagText(b, ['yt:videoId'])),
      desc: textOf(tagText(b, ['media:description'])),
      id: textOf(tagText(b, ['id', 'guid'])),
    });
  }
  return feed;
}

/* ---------- Text shaping ---------- */

function clip(s, n) {
  s = oneLine(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (stop > n * 0.55) return cut.slice(0, stop + 1);
  return cut.replace(/\s+\S*$/, '') + '…';
}
function firstSentence(s, n) {
  s = oneLine(s);
  const m = /^(.{20,}?[.!?])(\s|$)/.exec(s);
  const one = m ? m[1] : s;
  return clip(one, n);
}
const LEAD_LINES = /^(what[’']?s changing|quick (launch )?summary|quick summary|getting started|rollout pace|availability|resources|additional details|who[’']?s impacted|why (it[’']?s|you[’']?d use it)|why it matters|summary|overview|model updates:?|api updates:?|ai studio updates:?)$/i;
function summaryOf(html, title) {
  const lines = stripTags(html).split('\n').map(oneLine).filter((l) => l && !LEAD_LINES.test(l) && l !== title);
  return clip(lines.join(' '), CONFIG.summaryChars);
}

/* ---------- Tagging ---------- */

function findProducts(title, rest) {
  const specific = [], broad = [];
  const add = (p) => { const list = p.broad ? broad : specific; if (list.indexOf(p) < 0) list.push(p); };
  PRODUCTS.forEach((p) => { if (p.rx.test(title)) add(p); });
  PRODUCTS.forEach((p) => { if (rest && p.rx.test(rest)) add(p); });
  return { specific, broad };
}

const MODEL_RE = /\b(?:gemini|gemma|imagen|veo|lyria|chirp|medgemma|nano banana|gemini omni)[ -]?\d+(?:\.\d+)?(?:[ -](?:pro|flash|flash-lite|ultra|nano|omni|live|lite|image|fast))?\b|\bnano banana\b/i;
// allowModel: "New model" is kept for AI updates, or ones that talk about models, so a Workspace
// feature that merely mentions Gemini 3 isn't labelled a model launch.
function stageOf(text, type, allowModel) {
  const t = String(text || '');
  if (/^breaking$/i.test(type || '') || /\bbreaking change/i.test(t)) return 'breaking';
  if (/^deprecat/i.test(type || '') || /\b(deprecat\w*|shut(?:ting)? down|shutdown|sunset\w*|retir(?:e|es|ing|ement)|end of (?:life|support)|decommission\w*|discontinu\w*|will be removed)\b/i.test(t)) return 'deprecated';
  if (allowModel !== false && MODEL_RE.test(t) && /\b(releas\w*|launch\w*|introduc\w*|announc\w*|now available|available (?:in|on|now|today|to)|generally available|in preview|public preview|meet|new model|rolling out|arriv\w*|comes? to|now in)\b/i.test(t)) return 'model';
  if (/\bgenerally available\b|\bgeneral availability\b|\bnow GA\b|\(GA\)|\bis GA\b|\bGA release\b/i.test(t)) return 'ga';
  if (/\b(?:public |private )?preview\b|\bbeta\b|\bexperimental\b/i.test(t)) return 'preview';
  return '';
}
const STAGE_WEIGHT = { model: 50, ga: 40, breaking: 35, deprecated: 30, preview: 20, '': 10 };
const SOURCE_WEIGHT = { gcp: 0, ws: 5, gemapi: 5, cloudblog: 6, devblog: 8, kwai: 8, kwgemini: 8, kwdev: 8, kwws: 8, deepmind: 8,
  asnotes: 5, wsdev: 4, firebase: 8, appsheet: 5, appsheetnews: 8, antigravity: 4 };
function rankOf(it) { return (STAGE_WEIGHT[it.st || ''] || 10) + (SOURCE_WEIGHT[it.src] || 0); }

function docsFor(products) {
  const out = [];
  products.forEach((p) => {
    const u = p.docs || (p.slug ? 'https://docs.cloud.google.com/' + p.slug + '/docs' : '');
    if (u && !out.some((d) => d.u === u)) out.push({ n: p.n, u });
  });
  return out.slice(0, 2);
}

function makeItem(src, fields) {
  const found = fields.products || findProducts(fields.t, fields.s + ' ' + (fields.cats || []).join(' '));
  // The lead product is the first specific one, except that a model name doesn't take over a
  // non-AI source's update: a Workspace update about Gmail stays Workspace when it names Gemini 3
  let lead = found.specific[0];
  if (!fields.products && lead && lead.t === 'ai' && src.track !== 'ai') lead = found.specific.filter((p) => p.t !== 'ai')[0] || lead;
  const list = found.specific.length ? [lead].concat(found.specific.filter((p) => p !== lead)) : found.broad;
  const it = {
    id: fields.id || hashId(src.id + '|' + (fields.u || '') + '|' + fields.t),
    t: fields.t,
    s: fields.s,
    u: fields.u,
    d: fields.d,
    src: src.id,
    tr: lead ? lead.t : (fields.track || src.track),
    p: list.slice(0, 5).map((p) => p.n),
  };
  const text = fields.t + ' ' + fields.s;
  it.st = stageOf(text, fields.type, it.tr === 'ai' || /\bmodels?\b/i.test(text));
  if (fields.type) it.ty = fields.type;
  if (fields.g && it.p.indexOf(fields.g) < 0) it.g = fields.g;   // Google's own product heading, when ours differs
  const docs = fields.docs || docsFor(list);
  if (docs.length) it.dc = docs;
  it.r = rankOf(it);
  return it;
}

function hashId(s) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = ((h2 << 5) + h2 + c) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

/* ---------- Source parsers ---------- */

function inWindow(d, now) { return d && d >= now - CONFIG.keepDays * DAY && d <= now + DAY; }

function parseBlog(feed, s, now) {
  const out = [];
  feed.entries.forEach((e) => {
    if (!e.title || !e.link || !inWindow(e.date, now)) return;
    const sum = summaryOf(e.html || e.desc, e.title);
    const f = { t: e.title, s: sum, u: e.link, d: e.date, cats: e.cats };
    if (s.product) f.products = withBase(findProducts(e.title, sum + ' ' + (e.cats || []).join(' ')), s);
    out.push(makeItem(s, f));
  });
  return out;
}
// A single-product source (Firebase blog, AppSheet notes) always carries its product, and leads with
// it unless the update is mainly about something on the same track (Firebase Studio on the Firebase blog)
function withBase(found, s) {
  const base = PRODUCT_BY_NAME[(s.product || '').toLowerCase()];
  if (!base) return found;
  const rest = found.specific.filter((p) => p !== base);
  found.specific = rest.length && rest[0].t === base.t ? [rest[0], base].concat(rest.slice(1)) : [base].concat(rest);
  return found;
}

// Google Cloud's combined feed: one entry per day, each with every product's notes under
// <h2 class="release-note-product-title"> and each note under an <h3> type heading.
const GCP_SKIP_TYPES = /^(fixed|issue|issues|libraries|library|security)$/i;
const GCP_NOISE = [
  /^\(?\d{4}-R\d+\)?\s*version updates/i,
  /cluster versions have been updated/i,
  /installed latest packages from upstream/i,
  /^release [\d.]+ is now available/i,
  /internal and customer bug fixes/i,
  /^new versions? of the [\w .-]+ (?:are|is) available\.?$/i,
];
function parseGcpNotes(feed, s, now) {
  const out = [];
  feed.entries.forEach((e) => {
    if (!inWindow(e.date, now)) return;
    const anchor = (/#([A-Za-z]+_\d{2}_\d{4})/.exec(e.link || '') || [])[1] || '';
    const segs = String(e.html || '').split(/<h2\b[^>]*release-note-product-title[^>]*>/i).slice(1);
    segs.forEach((seg) => {
      const end = seg.indexOf('</h2>');
      if (end < 0) return;
      const productName = oneLine(stripTags(seg.slice(0, end)));
      const notes = seg.slice(end + 5).split(/<h3\b[^>]*>/i).slice(1);
      notes.forEach((n) => {
        const e3 = n.indexOf('</h3>');
        if (e3 < 0) return;
        const type = oneLine(stripTags(n.slice(0, e3)));
        if (GCP_SKIP_TYPES.test(type)) return;
        const body = n.slice(e3 + 5);
        const text = oneLine(stripTags(body));
        if (text.length < 15 || GCP_NOISE.some((rx) => rx.test(text))) return;
        const strong = /^\s*<p>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/i.exec(body);
        const title = strong ? oneLine(stripTags(strong[1])) : firstSentence(text, 140);
        const rest = strong ? oneLine(stripTags(body.slice(strong[0].length))) : text.slice(firstSentence(text, 1000).replace(/…$/, '').length).trim();

        // The product: our own name for it when we know it, else Google's heading as it is
        let prod = PRODUCTS.filter((p) => !p.broad && p.rx.test(productName))[0];
        const found = prod ? { specific: [prod], broad: [] } : { specific: [{ n: productName, t: trackForCloudProduct(productName) }], broad: [] };
        findProducts(title, rest).specific.forEach((p) => { if (found.specific.indexOf(p) < 0 && found.specific.length < 3) found.specific.push(p); });

        // Links: the product's own release notes page when we know its path, else the combined page
        const slug = prod && prod.slug ? prod.slug : '';
        const docLink = docsRootIn(body);
        const u = slug && anchor ? 'https://docs.cloud.google.com/' + slug + '/docs/release-notes#' + anchor : (e.link || s.home);
        const docs = slug ? [{ n: prod.n, u: 'https://docs.cloud.google.com/' + slug + '/docs' }]
          : docLink ? [{ n: productName, u: docLink }] : [];
        out.push(makeItem(s, {
          id: hashId('gcp|' + anchor + '|' + productName + '|' + type + '|' + text.slice(0, 160)),
          t: title.replace(/[.:]$/, ''),
          g: productName,
          s: clip(rest || text, CONFIG.summaryChars),
          u, d: e.date, type, products: found, docs,
        }));
      });
    });
  });
  return out;
}
function trackForCloudProduct(name) {
  if (/\b(gemini|vertex|agent|model garden|generative ai|ai applications|conversational agents|dialogflow)\b/i.test(name)) return 'ai';
  if (/\b(code assist|firebase|apps script|appsheet)\b/i.test(name)) return 'dev';
  return 'cloud';
}
// The docs home of the first Google Cloud docs link in a note: https://docs.cloud.google.com/<path>/docs
function docsRootIn(html) {
  const m = /href=["'](https:\/\/(?:docs\.)?cloud\.google\.com\/([a-z0-9\-\/]+?)\/docs)(?:[\/#?"'])/i.exec(html || '');
  return m ? 'https://docs.cloud.google.com/' + m[2] + '/docs' : '';
}

// The Gemini API changelog page: <h2> dates, each followed by lists of changes
const DATE_RE = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),\s+(\d{4})\b/i;
function mdy(text) {
  const m = DATE_RE.exec(text || '');
  if (!m) return 0;
  return Date.UTC(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2], 17);   // mid-morning in California
}
function parseChangelog(html, s, now) {
  if (!/^\s*<(!doctype|html|head|body)\b/i.test(String(html || ''))) return parseChangelogMd(html, s, now);
  const out = [];
  let page = String(html || '');
  const stop = page.search(/devsite-content-footer|<\/article>/i);
  if (stop > 0) page = page.slice(0, stop);
  const parts = page.split(/<h2\b/i).slice(1);
  if (!parts.length) throw new Error('no dated headings found');
  parts.forEach((part) => {
    const hEnd = part.indexOf('</h2>');
    if (hEnd < 0) return;
    const head = part.slice(0, hEnd);
    const d = mdy(stripTags('<h2' + head + '</h2>'));
    if (!d || !inWindow(d, now)) return;
    const idm = /\bid=["']([^"']+)["']/i.exec(head);
    const body = part.slice(hEnd + 5);
    // Each change as HTML, so a bold label at the start ("Gemini 3.7 Flash deprecation:") can be the title
    let bits = [];
    let m;
    const li = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    while ((m = li.exec(body))) bits.push(m[1]);
    if (!bits.length) {
      const p = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
      while ((m = p.exec(body))) bits.push(m[1]);
    }
    bits = bits.filter((h) => { const x = oneLine(stripTags(h)); return x.length >= 20 && !/:$/.test(x); });
    bits.slice(0, CONFIG.maxPerDayChangelog).forEach((h) => {
      const b = oneLine(stripTags(h));
      const lab = /^\s*(?:<p\b[^>]*>)?\s*<strong>([\s\S]*?)<\/strong>\s*:?\s*/i.exec(h);
      const label = lab ? oneLine(stripTags(lab[1])).replace(/:$/, '') : '';
      const title = label.length >= 8 ? label : firstSentence(b, 140);
      const rest = label.length >= 8 ? oneLine(stripTags(h.slice(lab[0].length))) : b.slice(title.replace(/…$/, '').length).trim();
      const found = findProducts(title, rest);
      const base = PRODUCT_BY_NAME[(s.product || '').toLowerCase()];
      if (base && found.specific.indexOf(base) < 0) found.specific.push(base);
      out.push(makeItem(s, {
        id: hashId('gemapi|' + d + '|' + b.slice(0, 160)),
        t: title.replace(/:$/, ''), s: clip(rest || b, CONFIG.summaryChars),
        u: s.home + (idm ? '#' + idm[1] : ''), d, products: found,
      }));
    });
  });
  return out;
}

// The same release notes in Markdown: "## October 27, 2026" headings, each followed by bullets (or
// paragraphs), a bold label at the start of a bullet ("**Gemini 3.7 Flash deprecation:**") as its title
function parseChangelogMd(md, s, now) {
  const out = [];
  const days = [];
  let cur = null;
  String(md || '').replace(/\r/g, '').replace(/```[\s\S]*?```/g, '').split('\n').forEach((l) => {
    const h = /^#{1,4}\s+(.+)/.exec(l);
    if (h) { const d = mdy(h[1]); cur = d ? { d, lines: [] } : (cur && !/^#{1,2}\s/.test(l) ? cur : null); if (d) days.push(cur); return; }
    if (cur) cur.lines.push(l);
  });
  if (!days.length) throw new Error('no dated headings found');
  days.forEach((day) => {
    if (!inWindow(day.d, now)) return;
    // Top-level bullets, each with the lines that carry on from it (nested bullets included)
    let bits = [], para = [], p = [], last = '';
    day.lines.forEach((l) => {
      const b = /^ ?[-*+]\s+(.*)/.exec(l);
      if (b) { bits.push(b[1]); last = 'bit'; return; }
      if (!l.trim()) { if (p.length) { para.push(p.join(' ')); p = []; } last = 'blank'; return; }
      // A line straight after a bullet, or an indented one (a nested bullet), carries on from it
      if (bits.length && (last === 'bit' || /^\s{2,}/.test(l))) { bits[bits.length - 1] += ' ' + l.trim().replace(/^[-*+]\s+/, ''); last = 'bit'; return; }
      p.push(l.trim()); last = 'para';
    });
    if (p.length) para.push(p.join(' '));
    if (!bits.length) bits = para;
    bits = bits.map((x) => x.trim()).filter((x) => { const t = oneLine(mdText(x)); return t.length >= 20 && !/:$/.test(t); });
    bits.slice(0, CONFIG.maxPerDayChangelog).forEach((raw) => {
      const b = oneLine(mdText(raw));
      const lab = /^\s*(\*\*|__)(.+?)\1\s*:?\s*/.exec(raw);
      const label = lab ? oneLine(mdText(lab[2])).replace(/:$/, '') : '';
      const title = label.length >= 8 ? label : firstSentence(b, 140);
      const rest = label.length >= 8 ? oneLine(mdText(raw.slice(lab[0].length))) : b.slice(title.replace(/…$/, '').length).trim();
      const found = findProducts(title, rest);
      const base = PRODUCT_BY_NAME[(s.product || '').toLowerCase()];
      if (base && found.specific.indexOf(base) < 0) found.specific.push(base);
      out.push(makeItem(s, {
        id: hashId('gemapi|' + day.d + '|' + b.slice(0, 160)),
        t: title.replace(/:$/, ''), s: clip(rest || b, CONFIG.summaryChars),
        u: s.home, d: day.d, products: found,
      }));
    });
  });
  return out;
}

// Google's developer release-note feeds (Apps Script, Workspace APIs): one entry per day, its notes as
// paragraphs or list items, sometimes under product headings. A leading label ("Generally Available:")
// becomes the stage, not part of the title.
const LABEL_RE = /^(generally available|developer preview|preview|beta|deprecated|deprecation|breaking change|change|fixed|new|announcement)\s*:\s*/i;
function parseDevFeed(feed, s, now) {
  const out = [];
  feed.entries.forEach((e) => {
    if (!inWindow(e.date, now)) return;
    const html = String(e.html || '');
    const groups = [];
    const parts = html.split(/<h[234]\b[^>]*>/i);
    if (parts.length > 1) {
      if (stripTags(parts[0]).length > 20) groups.push({ head: '', body: parts[0] });
      parts.slice(1).forEach((p) => {
        const end = p.search(/<\/h[234]>/i);
        if (end < 0) return;
        groups.push({ head: oneLine(stripTags(p.slice(0, end))), body: p.slice(p.indexOf('>', end) + 1) });
      });
    } else groups.push({ head: '', body: html });
    let n = 0;
    groups.forEach((g) => {
      // Paragraphs and list items in page order. A list after a paragraph ending in a colon
      // ("This release includes:") belongs to the note before it, so it becomes that note's summary.
      const blocks = [];
      let m;
      const re = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      while ((m = re.exec(g.body))) blocks.push({ li: m[1].toLowerCase() === 'li', text: oneLine(stripTags(m[2])) });
      if (!blocks.length) blocks.push({ li: false, text: oneLine(stripTags(g.body)) });
      let last = null, attach = false;
      blocks.forEach((b) => {
        const intro = /:$/.test(b.text);
        // A short unlabelled lead-in ("This release includes the following:") only introduces a list
        if (intro && !LABEL_RE.test(b.text) && b.text.length < 90) { attach = !!last; return; }
        if (b.li && attach && last) { last.more.push(b.text); return; }
        if (!b.li) attach = false;
        if (b.text.length < 25) return;
        const lab = LABEL_RE.exec(b.text);
        const type = lab ? lab[1] : '';
        if (GCP_SKIP_TYPES.test(type)) { last = null; return; }
        last = { type, text: (lab ? b.text.slice(lab[0].length) : b.text).replace(/:$/, ''), more: [] };
        g.notes = (g.notes || []).concat([last]);
        if (intro) attach = true;   // a note that ends by introducing its own list
      });
      (g.notes || []).forEach((note) => {
        if (n >= CONFIG.maxPerDayDevNotes) return;
        n++;
        const title = firstSentence(note.text, 140);
        const rest = oneLine(note.text.slice(title.replace(/…$/, '').length) + ' ' + note.more.join(' '));
        const ga = /^generally available$/i.test(note.type);
        const it = makeItem(s, {
          id: hashId(s.id + '|' + e.date + '|' + note.text.slice(0, 160)),
          t: title.replace(/[.:]$/, ''), s: clip(rest, CONFIG.summaryChars),
          u: e.link || s.home, d: e.date, products: withBase(findProducts(g.head + ' ' + title, rest), s),
          type: ga ? '' : note.type,
          g: g.head && !PRODUCT_BY_NAME[g.head.toLowerCase()] ? g.head : '',
        });
        if (ga) it.st = 'ga';
        else if (/preview|beta/i.test(note.type) && !it.st) it.st = 'preview';
        it.r = rankOf(it);
        out.push(it);
      });
    });
  });
  return out;
}

// Google's forum posts for AppSheet. Release-note posts are titled by date, so the first real change
// becomes the title; a post with nothing in it ("Features & enhancements: None") is left out.
const FORUM_SKIP = /^(features? (&|and) enhancements|bug fixes|rollout changes|preview features|item description|deployment time\b.*|none\.?|item|description|feature|bug|in addition.*|no new .*|read full topic|\d+ posts? - \d+ participants?.*)$/i;
function forumLines(html) {
  return stripTags(String(html || '').replace(/<small>[\s\S]*?<\/small>|<a\b[^>]*>\s*read full topic\s*<\/a>/gi, ''))
    .split('\n').map(oneLine).filter((l) => !FORUM_SKIP.test(l))
    .map((l) => l.replace(/^(feature|bug|item|change)\s+/i, ''))
    .filter((l) => l.length > 3 && !FORUM_SKIP.test(l));
}
function parseForum(feed, s, now) {
  const out = [];
  feed.entries.forEach((e) => {
    if (!e.title || !e.link || !inWindow(e.date, now) || /^about the /i.test(e.title)) return;
    const lines = forumLines(e.html);
    let title = e.title, sum = clip(lines.join(' '), CONFIG.summaryChars);
    if (/release notes?$|^\w+ \d{1,2},? \d{4}$/i.test(title)) {
      if (!lines.length) return;   // "Features & enhancements: None"
      title = firstSentence(lines[0], 140).replace(/[.]$/, '');
      sum = clip(lines.slice(1).join(' '), CONFIG.summaryChars);
    }
    out.push(makeItem(s, { t: title, s: sum, u: e.link, d: e.date, products: withBase(findProducts(title, sum), s) }));
  });
  return out;
}

// A changelog written in Markdown (Antigravity): one update per release, titled by its version and
// its first new feature, with the next couple of changes as the summary
function parseMdLog(md, s, now) {
  const out = [];
  const text = String(md || '');
  if (/^\s*<(!doctype|html)\b/i.test(text)) throw new Error('the changelog came back as a web page, not Markdown');
  const isoDate = (t) => { const m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(t); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 17) : 0; };
  const dateIn = (t) => mdy(t) || isoDate(t);
  // A heading with a version or a date starts a release; other headings ("Improvements") sit inside it
  const rels = [];
  let cur = null;
  text.split(/\r?\n/).forEach((l) => {
    const h = /^#{1,4}\s+(.+)/.exec(l);
    if (h && (/\b\d+\.\d+(?:\.\d+)?\b/.test(h[1]) || dateIn(h[1]))) { cur = { head: h[1].trim(), lines: [] }; rels.push(cur); }
    else if (cur) cur.lines.push(l);
  });
  if (!rels.length) throw new Error('no releases found');
  rels.forEach((r) => {
    const d = dateIn(r.head) || dateIn(r.lines.slice(0, 4).join('\n'));
    if (!d || !inWindow(d, now)) return;
    const ver = (/\bv?(\d+\.\d+(?:\.\d+)?)\b/.exec(r.head) || [])[1];
    const bullets = r.lines.map((l) => (/^\s*[-*•]\s+(.+)/.exec(l) || [])[1]).filter(Boolean)
      .map((b) => oneLine(b.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '')));
    if (!bullets.length) return;
    const lead = bullets.find((b) => !/^fix/i.test(b)) || bullets[0];
    const name = s.product.replace(/^Google /, '');
    const title = (ver ? name + ' ' + ver + ': ' : '') + firstSentence(lead, 120).replace(/[.]$/, '');
    const rest = bullets.filter((b) => b !== lead).slice(0, 3).join(' ');
    out.push(makeItem(s, { id: hashId(s.id + '|' + (ver || d) + '|' + lead.slice(0, 80)), t: title, s: clip(rest, CONFIG.summaryChars), u: s.home, d,
      products: withBase(findProducts(title, rest), s) }));
  });
  return out;
}

function parseVideos(feed, s, now) {
  const who = (feed.author || feed.title || '') + ' ' + ((feed.entries[0] && feed.entries[0].author) || '');
  if (s.expect && who.toLowerCase().indexOf(s.expect) < 0) throw new Error('the channel name was “' + oneLine(who) + '”, not ' + s.name);
  const out = [];
  feed.entries.forEach((e) => {
    if (!e.videoId || !e.title || !e.date || e.date < now - CONFIG.mediaDays * DAY) return;
    if (/#shorts\b/i.test(e.title)) return;
    const f = findProducts(e.title, (e.desc || '').slice(0, 300));
    out.push({ id: e.videoId, t: e.title, u: 'https://www.youtube.com/watch?v=' + e.videoId, ch: s.name, d: e.date,
      p: (f.specific.length ? f.specific : f.broad).slice(0, 3).map((p) => p.n), tr: trackOf(f) });
  });
  return out;
}
function trackOf(f) { const p = f.specific[0] || f.broad[0]; return p ? p.t : ''; }

function parseArticles(feed, s, now) {
  const out = [];
  feed.entries.forEach((e) => {
    if (!e.title || !e.link || !e.date || e.date < now - CONFIG.mediaDays * DAY) return;
    const u = e.link.replace(/\?source=rss[^#]*$/, '');
    const f = findProducts(e.title, (e.cats || []).join(' ') + ' ' + summaryOf(e.html, e.title).slice(0, 300));
    out.push({ id: hashId('art|' + u), t: e.title, u, by: e.author, d: e.date,
      p: (f.specific.length ? f.specific : f.broad).slice(0, 3).map((p) => p.n), tr: trackOf(f) });
  });
  return out;
}

/* ---------- Matching videos and articles to updates ---------- */

const STOP = {};
('google cloud gemini workspace with your from into more what when this that these those have about update updates ' +
 'release released releases support supports feature features generally preview public launch launches launched ' +
 'faster better easier help helps learn video part guide using build building built make makes made available ' +
 'introducing introduce introduces announcing announce announced today week weeks year years just also over their ' +
 'they them there here where which while will would could should been being does done each every first last next ' +
 'most much many some such than then very only into onto other others own same well work works working minute ' +
 'minutes episode series live show watch session sessions talk talks demo demos tips tricks free start started ' +
 'whats what’s news note notes change changes changed now new how why can get got use used uses').split(' ').forEach((w) => { STOP[w] = 1; });
// Words worth comparing: 4+ letters, version numbers (3.8) and longer numbers (6000)
function tokens(s) {
  const out = {};
  String(s || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9.]+/).forEach((w) => {
    w = w.replace(/^\.+|\.+$/g, '');
    if (!w || STOP[w]) return;
    if (/^\d+(\.\d+)+$/.test(w) || /^\d{3,}$/.test(w) || (w.length >= 4 && /^[a-z]/.test(w))) out[w.length > 4 ? w.replace(/(ies|es|s)$/, '') : w] = 1;
  });
  return out;
}
// A video or article goes with an update when they share a specific product and two telling words,
// two products and a word, or a product and a word when it came out within three days of the update.
// Words from the shared product's own name don't count, and media from more than two days before
// the update is ignored.
const NAME_WORDS = {};
PRODUCTS.forEach((p) => { NAME_WORDS[p.n] = Object.keys(tokens(p.n)); });
function matchMedia(items, media, key) {
  if (!media.length) return;
  const prepped = media.map((m) => ({ m, tok: tokens(m.t), p: m.p || [] }));
  items.forEach((it) => {
    const tok = tokens(it.t + ' ' + firstSentence(it.s || '', 160));
    const specific = (it.p || []).filter((n) => { const p = PRODUCT_BY_NAME[n.toLowerCase()]; return !p || !p.broad; });
    const scored = [];
    prepped.forEach((x) => {
      if (x.m.d < it.d - 2 * DAY) return;
      const both = (it.p || []).filter((n) => x.p.indexOf(n) >= 0);
      const skip = {};
      both.forEach((n) => (NAME_WORDS[n] || Object.keys(tokens(n))).forEach((w) => { skip[w] = 1; }));
      let shared = 0;
      for (const w in tok) if (x.tok[w] && !skip[w]) shared++;
      const sharedProducts = specific.filter((n) => x.p.indexOf(n) >= 0).length;
      const sharedBroad = both.length - sharedProducts;
      const soon = x.m.d >= it.d - DAY && x.m.d <= it.d + 3 * DAY;
      const ok = (sharedProducts >= 1 && shared >= 2) || (sharedProducts >= 2 && shared >= 1)
        || (sharedProducts >= 1 && shared >= 1 && soon) || (shared >= 3 && sharedBroad >= 1);
      if (!ok) return;
      const score = sharedProducts * 3 + shared + sharedBroad;
      if (score >= 4) scored.push({ id: x.m.id, score, d: x.m.d });
    });
    scored.sort((a, b) => b.score - a.score || b.d - a.d);
    if (scored.length) it[key] = scored.slice(0, 2).map((x) => x.id);
    else delete it[key];
  });
}

/* ======================================================================
   GitHub: read yesterday's brief, save today's
   ====================================================================== */

function gh(method, path, token, body) {
  const opts = {
    method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch('https://api.github.com/repos/' + CONFIG.repo + path, opts);
  return { code: r.getResponseCode(), text: r.getContentText() };
}
function tokenProblem(code) {
  if (code === 401) return 'GitHub turned the token down (401). It may have expired: make a new one and paste it into Script Properties as GITHUB_TOKEN.';
  return 'GitHub says the token can’t write to ' + CONFIG.repo + ' (' + code + '). Give it access to that repository with Contents set to Read and write.';
}

// Yesterday's brief and archive, merged into one, with the version (sha) of each file for saving
function readPrevious(token) {
  const a = readFile(token, CONFIG.file);
  const b = readFile(token, CONFIG.archive);
  let brief = a.brief;
  if (brief && b.brief) {
    brief = Object.assign({}, brief, {
      items: (brief.items || []).concat(b.brief.items || []),
      videos: (brief.videos || []).concat(b.brief.videos || []),
      articles: (brief.articles || []).concat(b.brief.articles || []),
    });
  }
  return { sha: a.sha, archiveSha: b.sha, brief };
}
function readFile(token, file) {
  const r = gh('get', '/contents/' + file + '?ref=' + CONFIG.branch, token);
  if (r.code === 404) return { sha: null, brief: null };
  if (r.code === 401) throw new Error(tokenProblem(401));
  if (r.code !== 200) throw new Error('GitHub answered ' + r.code + ' when reading ' + file + '. Try again later.');
  const j = JSON.parse(r.text);
  let text = '';
  if (j.content && j.encoding === 'base64') {
    text = Utilities.newBlob(Utilities.base64Decode(String(j.content).replace(/\s+/g, ''))).getDataAsString('UTF-8');
  } else if (j.download_url) {
    text = UrlFetchApp.fetch(j.download_url, { muteHttpExceptions: true }).getContentText('UTF-8');
  }
  let brief = null;
  try { brief = JSON.parse(text); } catch (e) { brief = null; }
  return { sha: j.sha || null, brief };
}

function publishBrief(token, json, sha, now, file) {
  file = file || CONFIG.file;
  const body = { message: (file === CONFIG.archive ? 'Archive, ' : 'Daily brief, ') + Utilities.formatDate(new Date(now), 'Europe/London', 'd MMM yyyy'),
    content: Utilities.base64Encode(json, Utilities.Charset.UTF_8), branch: CONFIG.branch };
  if (sha) body.sha = sha;
  let r = gh('put', '/contents/' + file, token, body);
  if (r.code === 409 || (r.code === 422 && /sha/i.test(r.text))) {
    // The file changed since we read it: take its new version and try once more
    const again = readFile(token, file);
    if (again.sha) body.sha = again.sha; else delete body.sha;
    r = gh('put', '/contents/' + file, token, body);
  }
  if (r.code === 200 || r.code === 201) return true;
  if (r.code === 401 || r.code === 403 || r.code === 404) throw new Error(tokenProblem(r.code));
  throw new Error('GitHub answered ' + r.code + ' when saving ' + file + ': ' + String(r.text).slice(0, 160));
}

/* ======================================================================
   Learn: one new set of three a day for each subject, from Google's own pages
   ----------------------------------------------------------------------
   Term (a concept explained), Tip (a how-to, with its code sample) and Did you know (something
   new from the brief, or a lesser-visited page). It runs on its own trigger at about 6:30am UK
   time, so the brief is never held up by it, and saves learn.json next to brief.json.

   Google's developer docs are licensed CC BY 4.0 (code samples Apache 2.0), so the app can show
   short excerpts with credit and a link back. Help Center pages aren't, so for those it keeps to
   the title and Google's own one-line summary. Which pages have been used is remembered in
   Script Properties, so nothing repeats until a subject's pages have all had a turn.
   ====================================================================== */

const LEARN = {
  file: 'learn.json',
  keepDays: 30,        // sets stay for a month
  firstRun: 5,         // sets per subject on the very first run, so Learn doesn't start empty
  perDay: 1,           // new sets per subject each day after that
  pagesPerSet: 3,      // pages read for each set (one spare, in case a page is too thin)
  maxPages: 900,       // remembered pages per subject
  spare: 4000,         // characters of ready-made pages kept per subject, for a morning its site turns Learn away
  hour: 6, minute: 30,
  topics: 4,          // a Help Center home page that links to few articles: how many of its topic pages to read too
  gap: 700,           // ms between Help Center pages: it turns away bursts with 429
  rest: 5000,         // ms to wait before one more try at anything turned away as too busy
};

const DOCS_CREDIT = (name) => 'From Google’s ' + name + ' docs, used under CC BY 4.0. Code samples Apache 2.0.';
// kind: devsite (Google developer docs), help (Help Center: title and summary only), sheetfns (the
// Sheets function list), readme (a GitHub README in Markdown), llms (an llms.txt index of Markdown pages).
// Most Google docs pages come as Markdown. The Gemini API docs moved into AI Studio (aistudio.google.com/docs),
// listed in the same llms.txt; their licence there isn't stated as CC BY, so like the Help Center they give
// only a title and Google's one-line summary (summaryOnly). Workspace Admin Help has moved from the Help Center
// to knowledge.workspace.google.com, a docs site like the others, and keeps to title and summary too.
const LEARN_SUBJECTS = [
  { id: 'appsscript', n: 'Apps Script', g: 'Google Workspace', kind: 'devsite', root: 'https://developers.google.com/apps-script/overview', path: '/apps-script/', docs: 'Apps Script', p: ['Apps Script'] },
  { id: 'clasp', n: 'clasp', g: 'Google Workspace', kind: 'readme', root: 'https://raw.githubusercontent.com/google/clasp/master/README.md', home: 'https://github.com/google/clasp', credit: 'From the clasp README on GitHub, used under Apache 2.0.', p: ['Apps Script'] },
  { id: 'wsapis', n: 'Workspace APIs', g: 'Google Workspace', kind: 'devsite', root: 'https://developers.google.com/workspace/guides/get-started', path: '/workspace/guides/', docs: 'Google Workspace developer', p: ['Workspace APIs'] },
  { id: 'sheetsapi', n: 'Sheets API', g: 'Google Workspace', kind: 'devsite', root: 'https://developers.google.com/workspace/sheets/api/guides/concepts', path: '/workspace/sheets/api/', docs: 'Sheets API', p: ['Google Sheets', 'Workspace APIs'] },
  { id: 'sheetsfns', n: 'Sheets functions', g: 'Google Workspace', kind: 'sheetfns', root: 'https://support.google.com/docs/table/25273?hl=en', credit: 'From Google’s Sheets function list.', p: ['Google Sheets'] },
  { id: 'gmailapi', n: 'Gmail API', g: 'Google Workspace', kind: 'devsite', root: 'https://developers.google.com/workspace/gmail/api/guides', path: '/workspace/gmail/api/', docs: 'Gmail API', p: ['Gmail'] },
  { id: 'chat', n: 'Chat apps', g: 'Google Workspace', kind: 'devsite', root: 'https://developers.google.com/workspace/chat/overview', path: '/workspace/chat/', docs: 'Google Chat developer', p: ['Google Chat'] },
  { id: 'addons', n: 'Workspace add-ons', g: 'Google Workspace', kind: 'devsite', root: 'https://developers.google.com/workspace/add-ons/overview', path: '/workspace/add-ons/', docs: 'Workspace add-ons', p: ['Workspace APIs', 'Workspace Studio'] },
  { id: 'appsheet', n: 'AppSheet', g: 'Google Workspace', kind: 'help', root: 'https://support.google.com/appsheet/?hl=en', path: '/appsheet/answer/', credit: 'From Google’s AppSheet Help Center.', p: ['AppSheet'] },
  { id: 'admin', n: 'Workspace admin', g: 'Google Workspace', kind: 'devsite', root: 'https://knowledge.workspace.google.com/admin/getting-started/admin-console-map', path: '/admin/', home: 'https://knowledge.workspace.google.com/admin', summaryOnly: true, credit: 'From Google Workspace Admin Help.', p: ['Admin console', 'Google Workspace'] },
  { id: 'gcp', n: 'Google Cloud & console', g: 'Google Cloud', kind: 'devsite', root: 'https://docs.cloud.google.com/docs/get-started', path: '/docs/', docs: 'Google Cloud', p: ['Google Cloud', 'IAM'] },
  { id: 'gcloud', n: 'gcloud CLI', g: 'Google Cloud', kind: 'devsite', root: 'https://docs.cloud.google.com/sdk/docs/install', path: '/sdk/docs/', docs: 'Google Cloud SDK', p: ['Google Cloud'] },
  { id: 'run', n: 'Cloud Run', g: 'Google Cloud', kind: 'devsite', root: 'https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run', path: '/run/docs/', docs: 'Cloud Run', p: ['Cloud Run', 'Cloud Run functions'] },
  { id: 'bigquery', n: 'BigQuery', g: 'Google Cloud', kind: 'devsite', root: 'https://docs.cloud.google.com/bigquery/docs/introduction', path: '/bigquery/docs/', docs: 'BigQuery', p: ['BigQuery'] },
  { id: 'agentplatform', n: 'Gemini Enterprise Agent Platform', g: 'Google Cloud', kind: 'devsite', root: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/overview', path: '/gemini-enterprise-agent-platform/', docs: 'Agent Platform', p: ['Agent Platform', 'Gemini Enterprise'] },
  { id: 'firebase', n: 'Firebase', g: 'Firebase & AI', kind: 'devsite', root: 'https://firebase.google.com/docs/guides', path: '/docs/', docs: 'Firebase', p: ['Firebase', 'Firebase Studio', 'Genkit'] },
  { id: 'firestore', n: 'Firestore', g: 'Firebase & AI', kind: 'devsite', root: 'https://firebase.google.com/docs/firestore', path: '/docs/firestore/', docs: 'Firestore', p: ['Firestore'] },
  { id: 'gemini', n: 'Gemini API & AI Studio', g: 'Firebase & AI', kind: 'llms', root: 'https://ai.google.dev/gemini-api/docs/llms.txt', only: /^https:\/\/(aistudio\.google\.com\/docs|ai\.google\.dev\/gemini-api\/docs)(\/|\.md|$)/, summaryOnly: true, home: 'https://aistudio.google.com/docs', credit: 'From Google’s Gemini API docs in AI Studio.', p: ['Gemini API', 'Google AI Studio', 'Gemini models'] },
  { id: 'antigravity', n: 'Google Antigravity', g: 'Firebase & AI', kind: 'llms', root: 'https://antigravity.google/llms.txt', home: 'https://antigravity.google/docs', credit: 'From the Google Antigravity docs.', p: ['Google Antigravity'] },
];
// Pages that teach nothing on their own: references, release notes, prices, limits, legal and indexes
const LEARN_SKIP = /\/(reference|release-?notes?|releases|support|pricing|quotas?|limits|terms|policies|libraries|rest|rpc|samples?|downloads?|faq|troubleshoot\w*|deprecat\w*|migrat\w*|legal|community|resources|whats-new|changelog|billing|available-regions|feedback-policies)(\/|$|\.)/i;

// Entry points: learn() is what the 6:30 trigger calls; learnPreview() builds a set for every subject without saving
function learn() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { console.log('Another run is already going. Nothing to do.'); return null; }
  const props = PropertiesService.getScriptProperties();
  try {
    const token = (props.getProperty('GITHUB_TOKEN') || '').trim();
    if (!token) throw new Error('No GitHub token yet. Add GITHUB_TOKEN under Project Settings → Script Properties.');
    const prev = readFile(token, LEARN.file);
    const brief = readFile(token, CONFIG.file).brief;
    const out = buildLearn(prev.brief, brief, Date.now(), learnState(props));
    publishBrief(token, JSON.stringify(out.learn), prev.sha, out.learn.generated, LEARN.file);
    out.state.save();
    const ok = out.learn.subjects.filter((s) => s.ok).length;
    const summary = { at: Date.now(), ok: true, fresh: out.fresh, sets: out.learn.sets.length, subjects: ok + ' of ' + out.learn.subjects.length };
    props.setProperty('LAST_LEARN', JSON.stringify(summary));
    console.log('Learn: ' + summary.fresh + ' new sets, ' + summary.sets + ' kept. Subjects working: ' + summary.subjects + '.');
    out.learn.subjects.filter((s) => !s.ok).forEach((s) => console.warn(s.n + ': ' + s.e));
    return summary;
  } catch (err) {
    const msg = String((err && err.message) || err);
    props.setProperty('LAST_LEARN', JSON.stringify({ at: Date.now(), ok: false, err: msg }));
    console.error(msg);
    throw err;
  } finally {
    lock.releaseLock();
  }
}
function learnPreview() {
  const out = buildLearn(null, null, Date.now(), learnState(null));
  out.learn.subjects.forEach((s) => console.log((s.ok ? 'OK    ' : 'FAIL  ') + s.n + (s.ok ? ': ' + s.c + ' sets' + (s.e ? ', ' + s.e : '') : ': ' + s.e)));
  // One set from each subject, to check the titles read well
  const shown = {};
  out.learn.sets.forEach((x) => { if (shown[x.s]) return; shown[x.s] = 1; console.log('[' + x.s + '] ' + x.parts.map((p) => p.label + ': ' + p.title).join(' | ')); });
  // Remembered for learnDebug, so it can look at just these without running everything again
  try { PropertiesService.getScriptProperties().setProperty('LEARN_PREVIEW_FAILS', JSON.stringify({ at: Date.now(), ids: out.learn.subjects.filter((s) => !s.ok).map((s) => s.id) })); } catch (e) { /* not saved */ }
  return { sets: out.learn.sets.length };
}

// learnDebug() looks closely at every subject learnPreview says FAIL for; learnDebug('bigquery') at just that one
function learnDebug(id) {
  const one = typeof id === 'string' ? id : '';   // to look at one subject, put its id in these last quotes, such as 'bigquery'
  let list;
  if (one) {
    const s = LEARN_SUBJECTS.find((x) => x.id === one);
    if (!s) { console.log('No subject called ' + one + '. Try one of: ' + LEARN_SUBJECTS.map((x) => x.id).join(', ')); return; }
    list = [s];
  } else {
    // The subjects learnPreview said FAIL for in the last hour; else run everything to find them
    let last = null;
    try { last = JSON.parse(PropertiesService.getScriptProperties().getProperty('LEARN_PREVIEW_FAILS') || 'null'); } catch (e) { last = null; }
    const ids = last && Date.now() - last.at < 3600e3 ? last.ids : buildLearn(null, null, Date.now(), learnState(null)).learn.subjects.filter((x) => !x.ok).map((x) => x.id);
    list = ids.map((id) => LEARN_SUBJECTS.find((y) => y.id === id)).filter(Boolean);
    if (!list.length) { console.log('Every subject reads fine. Nothing to look at.'); return; }
    console.log('Looking at ' + list.length + ': ' + list.map((s) => s.id).join(', '));
  }
  list.forEach(learnDebugOne);
}
function learnDebugOne(s) {
  const what = (t) => (looksLikeHtml(t) ? 'a web page' : 'Markdown');
  const short = (u) => String(u).replace(/^https:\/\/[^\/]+/, '');
  const r = learnFetch([s.root], learnRootAccept(s))[0];
  console.log('── ' + s.n + ' (' + s.id + '): ' + s.root + ' answered ' + r.code + ', ' + r.text.length + ' characters, ' + what(r.text) + (r.type ? ' (' + r.type.split(';')[0] + ')' : '') + '.');
  if (!r.ok) return;
  console.log('It starts: ' + clip(r.text.slice(0, 600), 280));
  let pool = [];
  try { pool = learnPool(s, r.text, s.root); } catch (e) { console.log('Reading its list of pages failed: ' + e.message); }
  console.log(pool.length + ' pages found' + (s.path ? ' under ' + s.path : '') + '. First few: ' + pool.slice(0, 4).map((x) => short(x.link || x.u) + (x.title || x.hint ? ' “' + (x.title || x.hint) + '”' : '')).join('  '));
  if (s.kind === 'help') console.log('Topic pages it links to: ' + helpTopics(s, r.text).length + '. ' + helpTopics(s, r.text).slice(0, 4).map(short).join('  '));
  if (!pool.length) {
    console.log('Links on it: ' + (r.text.match(/href=["'][^"']+|\]\([^)\s]+/g) || []).slice(0, 12).join('  '));
    return;
  }
  const first = pool.find((x) => x.needsFetch);
  if (!first) { console.log('Read as: ' + JSON.stringify(pool[0]).slice(0, 300)); return; }
  const pg = learnFetch([first.u], learnAccept(s))[0];
  console.log('First page, ' + short(first.u) + ', answered ' + pg.code + ', ' + pg.text.length + ' characters, ' + what(pg.text) + '. It starts: ' + clip(pg.text.slice(0, 400), 200));
  try {
    const got = s.kind === 'llms' ? parseMdPage(pg.text) : parseDocPage(pg.text, s.kind);
    console.log('Read as: ' + JSON.stringify({ title: got.title, desc: clip(got.desc || '', 90), para: clip(got.para || '', 140), code: String(got.code || '').split('\n')[0], skip: got.skip }));
  } catch (e) { console.log('Reading it failed: ' + e.message); }
  if (s.kind === 'devsite' || s.kind === 'llms') {
    const web = learnFetch([first.link || first.u], LEARN_ACCEPT.page)[0];
    console.log('Asked for as a web page it answered ' + web.code + ', ' + what(web.text) + ', with the title “' + pageHead(web.text).title + '”.');
  }
}

// Which pages each subject has used, and which brief items and videos have been used, kept in
// Script Properties (one entry per subject, well under the 9 KB a property may hold)
function learnState(props) {
  const mem = {};
  const get = (k) => { if (!(k in mem)) { let v = null; try { v = JSON.parse((props && props.getProperty(k)) || 'null'); } catch (e) { v = null; } mem[k] = v; } return mem[k]; };
  const fit = (l, step) => { while (l.length && JSON.stringify(l).length > 8500) l = l.slice(step); return l; };
  return {
    seen: (id) => get('LEARN_SEEN_' + id) || [],
    setSeen: (id, list) => { mem['LEARN_SEEN_' + id] = fit(list.slice(-LEARN.maxPages), 50); },
    // Pages found linked from pages already read, kept short (the part after the subject's address)
    found: (id) => get('LEARN_FOUND_' + id) || [],
    setFound: (id, list) => { mem['LEARN_FOUND_' + id] = fit(list.slice(-400), 20); },
    spare: (id) => get('LEARN_SPARE_' + id) || [],
    setSpare: (id, list) => { let l = list.slice(0, 30); while (l.length && JSON.stringify(l).length > LEARN.spare) l = l.slice(0, -1); mem['LEARN_SPARE_' + id] = l; },
    used: () => get('LEARN_USED') || [],
    setUsed: (list) => { mem.LEARN_USED = fit(list.slice(-500), 20); },
    save: () => { if (props) Object.keys(mem).forEach((k) => { if (mem[k]) props.setProperty(k, JSON.stringify(mem[k])); }); },
  };
}
const shortHash = (s) => hashId(s).slice(0, 8);
// An order for shuffling: the hash, well stirred, so pages with similar addresses land far apart
function mixKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

function buildLearn(prev, brief, now, state) {
  const first = !(prev && prev.v === 1 && (prev.sets || []).length);
  const want = first ? LEARN.firstRun : LEARN.perDay;
  const statuses = LEARN_SUBJECTS.map((s) => ({ id: s.id, n: s.n, g: s.g, h: s.home || s.root.replace(/\/llms\.txt$|\?hl=en$/, ''), ok: false, c: 0, e: '' }));
  const items = (brief && brief.items) || [], videos = (brief && brief.videos) || [];
  let used = state.used().slice();

  // 1. Each subject's starting page: the pages it links to are the ones to work through
  const kindOf = {};
  LEARN_SUBJECTS.forEach((s) => { kindOf[s.root] = s; });
  const roots = learnFetch(LEARN_SUBJECTS.map((s) => s.root), (u) => learnRootAccept(kindOf[u]));
  const plans = LEARN_SUBJECTS.map((s, i) => {
    const r = roots[i], st = statuses[i];
    if (!r.ok) { st.e = learnWhy(r); return null; }
    try {
      const pool = learnPool(s, r.text, s.root);
      // A Markdown page links only to what it mentions, so the list grows as pages are read
      if (s.kind === 'devsite' || s.kind === 'help') {
        const have = {};
        pool.forEach((x) => { have[x.u] = 1; });
        const pre = learnBase(s);
        state.found(s.id).forEach((rel) => { const u = pre + String(rel).replace(/(\.md(\.txt)?)+$/i, ''); if (!have[u]) { have[u] = 1; pool.push({ u, needsFetch: true }); } });
      }
      const topics = s.kind === 'help' && pool.length < want * LEARN.pagesPerSet + 2 ? helpTopics(s, r.text).slice(0, LEARN.topics) : [];
      if (!pool.length && !topics.length) throw new Error('no pages found');
      return { s, st, pool, topics };
    } catch (err) { st.e = 'could not be read (' + String(err.message || err).slice(0, 60) + ')'; return null; }
  });
  // A Help Center home page that links to only a few articles: its topic pages list more
  const topicUrls = [];
  plans.forEach((pl) => { if (pl) pl.topics.forEach((u) => topicUrls.push(u)); });
  const topicPages = learnFetch(topicUrls, LEARN_ACCEPT.html), topicText = {};
  topicUrls.forEach((u, i) => { if (topicPages[i].ok) topicText[u] = topicPages[i].text; });
  plans.forEach((pl, i) => {
    if (!pl || !pl.topics.length) return;
    const have = {};
    pl.pool.forEach((x) => { have[x.u] = 1; });
    pl.topics.forEach((u) => { if (topicText[u]) learnPool(pl.s, topicText[u], u).forEach((x) => { if (!have[x.u]) { have[x.u] = 1; pl.pool.push(x); } }); });
    if (!pl.pool.length) { pl.st.e = 'could not be read (no pages found)'; plans[i] = null; }
  });

  // 2. Today's pages: ones not used before, in a shuffled order that changes each time round
  const toFetch = [];
  plans.forEach((pl) => {
    if (!pl) return;
    let seen = state.seen(pl.s.id);
    let fresh = pl.pool.filter((x) => seen.indexOf(shortHash(x.u)) < 0);
    if (fresh.length < want * 2) { seen = []; fresh = pl.pool.slice(); }   // all used: start a new round
    const round = Math.floor(seen.length / Math.max(1, pl.pool.length));
    fresh.sort((a, b) => mixKey(pl.s.id + round + a.u + (a.title || '')) - mixKey(pl.s.id + round + b.u + (b.title || '')));
    pl.pick = fresh.slice(0, want * LEARN.pagesPerSet + 2);   // two spare, for pages too thin to use
    // A list that already holds each page's words (Sheets functions, a README, an llms.txt with summaries):
    // the next few go in the subject's reserve
    pl.extra = fresh.slice(pl.pick.length, pl.pick.length + 15).filter((x) => !x.needsFetch && x.title && (x.desc || x.para));
    pl.seen = seen.concat(pl.pick.map((x) => shortHash(x.u)));
    pl.pick.forEach((x) => { if (x.needsFetch) { toFetch.push(x.u); kindOf[x.u] = pl.s; } });
  });
  const fetched = {};
  const got = learnFetch(toFetch, (u) => learnAccept(kindOf[u]));
  toFetch.forEach((u, i) => { fetched[u] = got[i]; });

  // 3. Read them, keeping note of the pages they link to and of why any page couldn't be used
  plans.forEach((pl) => {
    if (!pl) return;
    if (pl.s.kind === 'devsite' || pl.s.kind === 'help') {
      const pre = learnBase(pl.s), known = state.found(pl.s.id).map((rel) => String(rel).replace(/(\.md(\.txt)?)+$/i, '')), have = {};
      known.forEach((rel) => { have[rel] = 1; });
      pl.pool.forEach((x) => { have[x.u.slice(pre.length)] = 1; });
      pl.pick.forEach((x) => {
        const r = fetched[x.u];
        if (r && r.ok) learnPool(pl.s, r.text, x.u).forEach((y) => { const rel = y.u.slice(pre.length); if (!have[rel]) { have[rel] = 1; known.push(rel); } });
      });
      state.setFound(pl.s.id, known);
    }
    const why = { failed: {}, thin: 0, old: 0 };
    pl.why = why;
    pl.pages = pl.pick.map((x) => {
      if (!x.needsFetch) return x;
      const r = fetched[x.u];
      if (!r || !r.ok) { const k = learnWhy(r); why.failed[k] = (why.failed[k] || 0) + 1; return null; }
      try {
        const got = pl.s.kind === 'llms' ? parseMdPage(r.text) : parseDocPage(r.text, pl.s.kind);
        if (got.skip) { why.old++; return null; }
        const page = { u: x.link || x.u, title: x.title || '', hint: x.hint || '', desc: x.desc || '' };   // the link's own words, or an llms.txt line's title and summary
        Object.keys(got).forEach((k) => { if (got[k]) page[k] = got[k]; });
        if (pl.s.summaryOnly) { if (!page.desc) page.desc = firstSentence(page.para || '', 200); page.para = ''; page.code = ''; }
        if (!page.desc && !page.para) { why.thin++; return null; }
        return page;
      } catch (e) { why.thin++; return null; }
    }).filter(Boolean);
  });

  // 4. A Markdown page with no title of its own: the web page's title, else one made from its address
  const untitled = [];
  plans.forEach((pl) => { if (pl) pl.pages.forEach((p) => { if (!p.title) untitled.push(p); }); });
  const heads = learnFetch(untitled.map((p) => p.u), LEARN_ACCEPT.page);
  untitled.forEach((p, i) => {
    const h = heads[i];
    if (!h || !h.ok) return;
    const t = pageHead(h.text);
    if (DEPRECATED.test(t.title + ' ' + t.desc)) p.skip = 'deprecated';
    if (t.title) p.title = t.title;
    if (!p.desc && t.desc) p.desc = t.desc;
  });
  plans.forEach((pl) => { if (pl) pl.pages.forEach((p) => { if (!p.title) p.title = p.hint || slugTitle(p.u, pl.s); delete p.hint; }); });

  // 5. Sets of three. Pages left over go in the subject's reserve; a subject whose site turned Learn away
  // today (a 429 from the Help Center, say) makes its set from yesterday's reserve instead.
  const sets = [];
  const keep = (x) => { const o = { u: x.u, title: x.title, desc: x.desc || '', para: x.para || '', code: x.code || '' }; if (x.kind) o.kind = x.kind; return o; };
  LEARN_SUBJECTS.forEach((s, i) => {
    const pl = plans[i], st = statuses[i];
    let pages = pl ? pl.pages.filter((x) => !x.skip && x.title && (x.desc || x.para)) : [];
    const usable = pages.length;
    let seen = pl ? pl.seen : state.seen(s.id), fromSpare = false;
    if (!pl || usable < 2) {
      const spare = state.spare(s.id).filter((x) => seen.indexOf(shortHash(x.u)) < 0);
      if (spare.length >= 2) { pages = spare; fromSpare = true; }
    }
    let mine = items.filter((it) => (it.p || []).some((n) => s.p.indexOf(n) >= 0) && used.indexOf(it.id) < 0);
    let vids = videos.filter((v) => (v.p || []).some((n) => s.p.indexOf(n) >= 0) && used.indexOf(v.id) < 0).sort((a, b) => b.d - a.d);
    let made = 0;
    const before = pages.slice();
    for (let k = 0; k < want; k++) {
      const set = makeLearnSet(s, pages, mine, vids, now - k * 60e3);
      if (!set) break;
      set.used.forEach((id) => used.push(id));
      mine = mine.filter((it) => set.used.indexOf(it.id) < 0);
      vids = vids.filter((v) => set.used.indexOf(v.id) < 0);
      delete set.used;
      sets.push(set);
      made++;
    }
    if (fromSpare) {
      const gone = before.filter((x) => pages.indexOf(x) < 0);
      seen = seen.concat(gone.map((x) => shortHash(x.u)));
      state.setSpare(s.id, pages);
    } else if (pl) {
      // Pages read but not used today stay unseen, so they can come round again (or from the reserve)
      const left = pages.map((x) => shortHash(x.u));
      seen = seen.filter((h) => left.indexOf(h) < 0);
      state.setSpare(s.id, pages.concat(pl.extra || []).map(keep));
    }
    if (pl || fromSpare) state.setSeen(s.id, seen);
    st.c = made;
    st.ok = made > 0;
    const why = st.e;
    if (fromSpare && made) st.e = 'made from its reserve today (' + (why ? why.replace(/ \(too many requests; tries again next run\)/, ', too many requests') : 'too few usable pages') + ')';
    else if (pl && !made) {
      const w = pl.why, bits = Object.keys(w.failed).map((k) => w.failed[k] + ' ' + k);
      if (w.thin) bits.push(w.thin + ' with nothing to show');
      if (w.old) bits.push(w.old + ' deprecated');
      st.e = 'no usable pages today (' + pl.pick.length + ' tried, ' + usable + ' usable' + (bits.length ? ': ' + bits.join(', ') : '') + ')';
    } else if (made) st.e = '';
  });
  state.setUsed(used);

  // Keep a month, newest first
  const keepFrom = now - LEARN.keepDays * DAY;
  const have = {};
  sets.forEach((x) => { have[x.id] = 1; });
  const old = first ? [] : prev.sets.filter((x) => x.d >= keepFrom && !have[x.id]);
  const all = sets.concat(old).sort((a, b) => b.d - a.d).slice(0, 900);
  return { fresh: sets.length, state, learn: { v: 1, generated: now, keepDays: LEARN.keepDays, subjects: statuses, sets: all } };
}

// Fetches in parallel, a batch at a time; one bad address never sinks the rest. Google's developer
// docs send a Markdown copy of a page when asked for one, which is cleaner to read than the page
// itself; Help Center pages are asked for plain web pages, and so is a docs page whose Markdown has
// no title (the web page's <title> has it).
const LEARN_ACCEPT = { md: 'text/markdown, text/plain;q=0.9, text/html;q=0.8', html: 'text/html, */*;q=0.5', page: 'text/html, application/xhtml+xml;q=0.9' };
const learnAccept = (s) => (s && (s.kind === 'devsite' || s.kind === 'llms' || s.kind === 'readme') ? LEARN_ACCEPT.md : LEARN_ACCEPT.html);
// A docs subject's starting page is read as a web page: its left-hand menu lists every page in the section,
// with the menu's own titles, where the Markdown copy only links to what its text mentions
const learnRootAccept = (s) => (s && s.kind === 'devsite' ? LEARN_ACCEPT.page : learnAccept(s));
const learnWhy = (r) => (!r || !r.code ? 'could not be reached' : r.code === 429 ? 'answered 429 (too many requests; tries again next run)' : 'answered ' + r.code);
const LEARN_GENTLE = /^https:\/\/support\.google\.com\//;   // Help Center: one page at a time
const learnPause = (ms) => { try { Utilities.sleep(ms); } catch (e) { /* no pause available */ } };
function learnFetch(urls, accept) {
  const req = (u) => ({ url: u, muteHttpExceptions: true, followRedirects: true, headers: { Accept: (typeof accept === 'function' ? accept(u) : accept) || LEARN_ACCEPT.html } });
  const one = (u) => { try { const o = req(u); delete o.url; return UrlFetchApp.fetch(u, o); } catch (e) { return null; } };
  const read = (r) => {
    let code = 0, text = '', type = '';
    if (r) {
      code = r.getResponseCode();
      try { text = r.getContentText('UTF-8'); } catch (e) { text = ''; }
      try { const h = r.getHeaders ? r.getHeaders() : {}; type = String(h['Content-Type'] || h['content-type'] || ''); } catch (e) { type = ''; }
    }
    let wait = 0;
    try { const h = r && r.getHeaders ? r.getHeaders() : {}; wait = Math.min(30, parseInt(h['Retry-After'] || h['retry-after'] || '0', 10) || 0) * 1000; } catch (e) { wait = 0; }
    return { ok: code >= 200 && code < 300 && text.length > 0, code, text, type, wait };
  };
  const out = new Array(urls.length), fast = [], gentle = [];
  urls.forEach((u, i) => (LEARN_GENTLE.test(u) ? gentle : fast).push(i));
  // Everything else in parallel, a batch at a time; one bad address never sinks the rest
  for (let i = 0; i < fast.length; i += 30) {
    const ix = fast.slice(i, i + 30);
    let res;
    try { res = UrlFetchApp.fetchAll(ix.map((k) => req(urls[k]))); } catch (e) { res = ix.map((k) => one(urls[k])); }
    ix.forEach((k, j) => { out[k] = read(res[j]); });
  }
  gentle.forEach((k, j) => { if (j) learnPause(LEARN.gap); out[k] = read(one(urls[k])); });
  // Turned away as too busy: up to two more tries each, the second after a longer rest (or as long as the site asks)
  for (let round = 0; round < 2; round++) {
    const busy = [];
    out.forEach((r, k) => { if (r.code === 429 || r.code === 503) busy.push(k); });
    if (!busy.length) break;
    learnPause(Math.max(LEARN.rest * (round ? 3 : 1), Math.max.apply(null, busy.map((k) => out[k].wait || 0))));
    busy.forEach((k, j) => { if (j) learnPause(LEARN.gap); out[k] = read(one(urls[k])); });
  }
  return out;
}

const learnBase = (s) => /^https?:\/\/[^\/]+/.exec(s.root)[0] + s.path;
// Words that make poor titles when they're all a link says
const LINK_GENERIC = /^(learn more|read more|more|more info(rmation)?|here|click here|this( page| guide| document| doc| tutorial| article| section)?|see (more|details|the docs?|also)|details|docs?|documentation|link|guides?|overview|introduction|intro|reference|next|previous|back|home|video|watch|guide me|try it|open|download|view|get started|getting started|quickstarts?|tutorials?|concepts|samples?|(next|further) steps|what[’']?s next|all products|products|start here|faq)$/i;
// A link's words as a title. Strong: a menu label or heading-like link (capitalised, two words or more).
// Weak: a single word or words from the middle of a sentence, kept only as a fallback.
function linkTitle(raw) {
  let t = oneLine(mdText(raw)).replace(/^[\s"'“‘(]+|[\s.,:;"'”’)]+$/g, '');
  if (t.length < 3 || t.length > 90 || !/[a-z]/i.test(t) || LINK_GENERIC.test(t) || /^https?:|\.md(\.txt)?$|[{}<>]|\b(arrow_forward|open_in_new|chevron_right)\b/.test(t)) return { text: '', strong: false };
  const strong = /^[A-Z0-9]/.test(t) && / /.test(t);
  // Capitalised, unless it starts with a command or a name written in lower case on purpose
  if (/^[a-z]/.test(t) && !/^(gcloud|gsutil|bq|clasp|kubectl|npm|npx|git|curl|e\.g|i\.e)\b/.test(t) && !/^\S*[A-Z_.()]/.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
  return { text: t, strong };
}
// A relative link, worked out from the page it's on
function resolveUrl(page, rel) {
  const m = /^(https?:\/\/[^\/]+)(\/[^?#]*)?/.exec(page);
  if (!m) return rel;
  const parts = (m[2] || '/').split('/');
  parts.pop();
  rel.split('/').forEach((p) => { if (p === '..') { if (parts.length > 1) parts.pop(); } else if (p !== '.') parts.push(p); });
  return m[1] + parts.join('/');
}
// The pages a subject can draw from, from a page of it: links in a web page or in Markdown, each with
// the words of its link (a title for pages whose Markdown has none)
function learnPool(s, text, from) {
  if (s.kind === 'sheetfns') return parseFunctionList(text);
  if (s.kind === 'readme') return parseReadme(text, s.home);
  if (s.kind === 'llms') return parseLlms(text, s);
  text = String(text || '');
  const base = /^https?:\/\/[^\/]+/.exec(s.root)[0], page = String(from || s.root);
  const out = [], at = {};
  const add = (raw, words) => {
    let u = decode(String(raw || '').trim());
    if (!u || /^(#|mailto:|javascript:|data:|tel:)/i.test(u)) return;
    u = u.replace(/[?#].*$/, '');
    if (/^\/\//.test(u)) u = 'https:' + u;
    else if (/^\//.test(u)) u = base + u;
    else if (!/^https?:/i.test(u)) u = resolveUrl(page, u);
    u = u.replace(/^http:/i, 'https:').replace(/(\.md(\.txt)?)+$/i, '');
    if (u.indexOf(base + s.path) !== 0 || LEARN_SKIP.test(u.slice(base.length)) || /\.(png|jpe?g|gif|svg|webp|pdf|zip|json|xml|ya?ml|txt|csv)$/i.test(u)) return;
    u = u.replace(/\/$/, '');
    if (s.kind === 'help') u = u.replace(/(\/answer\/\d+).*$/, '$1');
    const w = words == null ? { text: '', strong: false } : linkTitle(words);
    if (u in at) {
      const x = out[at[u]];
      if (w.strong && !x.title) { x.title = w.text; x.hint = ''; } else if (w.text && !x.title && !x.hint) x.hint = w.text;
      return;
    }
    at[u] = out.length;
    out.push({ u, needsFetch: true, title: w.strong ? w.text : '', hint: w.strong ? '' : w.text });
  };
  let m;
  // <a href="…">words</a>, the words stopping short of any other link, so a stray <a in a script can't swallow the rest
  const a = /<a\b[^>]*?\bhref\s*=\s*(["'])([^"'<>]*?)\1[^>]*>((?:(?!<\/?a\b)[\s\S]){0,600}?)<\/a>/gi;
  while ((m = a.exec(text))) add(m[2], m[3]);
  const h = /\bhref\s*=\s*(["'])([^"'<>\s]+)\1/gi;   // and every other href="…", words or not
  while ((m = h.exec(text))) add(m[2], null);
  if (s.kind === 'help') {
    // Help Center pages also carry article addresses in their scripts, with the slashes escaped
    const re = helpPathRe(s, 'answer');
    while ((m = re.exec(text))) add(base + '/' + helpSeg(s) + '/answer/' + m[1], null);
  }
  if (!looksLikeHtml(text)) {
    const md = /\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?[^)\n]*\)/g;             // [words](…)
    while ((m = md.exec(text))) add(m[2], m[1]);
  }
  return out.slice(0, LEARN.maxPages);
}

// Help Center addresses: /a/answer/123 or /a/topic/123, written plainly or escaped (\/a\/answer\/123, \u002Fa…)
const helpSeg = (s) => s.path.split('/')[1];
function helpPathRe(s, kind) {
  const sl = '(?:\\\\u002[Ff]|\\\\?/)';
  return new RegExp(sl + helpSeg(s) + sl + kind + sl + '(\\d{3,})', 'g');
}
function helpTopics(s, text) {
  const base = /^https?:\/\/[^\/]+/.exec(s.root)[0], out = [];
  let m;
  const re = helpPathRe(s, 'topic');
  while ((m = re.exec(String(text || '')))) { const u = base + '/' + helpSeg(s) + '/topic/' + m[1]; if (out.indexOf(u) < 0) out.push(u); }
  return out;
}

// A title made from a page's address, for the rare page that has no title anywhere
const SLUG_WORDS = { api: 'API', apis: 'APIs', oauth: 'OAuth', sql: 'SQL', cli: 'CLI', iam: 'IAM', ui: 'UI', ai: 'AI', ml: 'ML', sdk: 'SDK', sdks: 'SDKs',
  url: 'URL', urls: 'URLs', json: 'JSON', csv: 'CSV', http: 'HTTP', https: 'HTTPS', vpc: 'VPC', gpu: 'GPU', gpus: 'GPUs', tpu: 'TPU', tpus: 'TPUs', rest: 'REST',
  grpc: 'gRPC', mcp: 'MCP', adk: 'ADK', rag: 'RAG', gke: 'GKE', bi: 'BI', id: 'ID', ids: 'IDs', iap: 'IAP', dns: 'DNS', vm: 'VM', vms: 'VMs', js: 'JavaScript',
  nodejs: 'Node.js', html: 'HTML', css: 'CSS', bigquery: 'BigQuery', gmail: 'Gmail', google: 'Google', workspace: 'Workspace', firebase: 'Firebase',
  firestore: 'Firestore', gemini: 'Gemini', cloud: 'Cloud', sheets: 'Sheets', drive: 'Drive', chat: 'Chat', python: 'Python', java: 'Java', go: 'Go' };
function slugTitle(u, s) {
  const seg = (String(u).replace(/^https?:\/\/[^\/]+/, '').replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || '').replace(/\.\w+$/, '');
  const words = seg.split(/[-_]+/).filter(Boolean).map((w) => SLUG_WORDS[w.toLowerCase()] || w.toLowerCase());
  if (!words.length || /^(overview|intro(duction)?|index|docs?|about|guides?|learn|concepts?|basics)$/i.test(seg)) return s.n + (/^concepts?|basics$/i.test(seg) ? ' ' + words.join(' ') : ' overview');
  if (/^(get-?started|getting-started)$/i.test(seg)) return 'Get started with ' + s.n;
  const t = words.join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// A web page's own title and description, from its <head>; for Markdown, its # title
function pageHead(t) {
  t = String(t || '');
  if (!looksLikeHtml(t)) { try { const p = parseDocMd(t); return { title: p.title || '', desc: p.desc || '' }; } catch (e) { return { title: '', desc: '' }; } }
  let title = oneLine(decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(t) || [])[1] || '')).replace(/\s+[|–—]\s+.*$/, '').replace(/\s+-\s+[^-]*Help$/i, '');
  if (!title) title = metaContent(t, 'og:title');
  return { title: clip(title, 90), desc: clip(metaContent(t, 'description') || metaContent(t, 'og:description'), 240) };
}
// <meta name="…" content="…">, either way round, with apostrophes inside the content kept
function metaContent(html, name) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (let i = 0; i < tags.length; i++) {
    const n = /\b(?:name|property)\s*=\s*(["'])(.*?)\1/i.exec(tags[i]);
    if (!n || n[2].toLowerCase() !== name) continue;
    const c = /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(tags[i]);
    if (c) return oneLine(decode(c[2]));
  }
  return '';
}

// A Google docs page (or a Help Center article): title, Google's one-line summary, opening paragraph
// and first code sample. Help Center pages keep to the title and summary.
const LEAD_SKIP = /^(note|caution|warning|important|preview|beta|key ?point|objective|tip|pre-?release|this (feature|product) is|before you begin|in this (page|document|tutorial|guide)|to follow step-by-step guidance|for step-by-step guidance|stay organized with collections|video)\b/i;
const DEPRECATED = /\b(deprecated|shut down|no longer (supported|available))\b/i;
function parseDocPage(html, kind) {
  html = String(html || '');
  if (kind !== 'help' && !looksLikeHtml(html)) return parseDocMd(html);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  let title = oneLine(stripTags(h1 ? h1[1] : '')).replace(/\s*Stay organized with collections.*$/i, '');
  if (!title || title.length > 120) title = pageHead(html).title;
  title = title.replace(/\s+-\s+(AppSheet Help|Google Workspace Admin Help|.* Help)$/i, '');
  const desc = metaContent(html, 'description') || metaContent(html, 'og:description');
  if (DEPRECATED.test(title + ' ' + desc)) return { skip: 'deprecated' };
  if (kind === 'help') {
    // No summary of its own: the article's first real sentence stands in for one
    let d = desc;
    if (!d) {
      const body = html.slice(Math.max(0, html.search(/<article\b|class=["'][^"']*(article-content|cc)\b/i)));
      let m;
      const p = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
      while (!d && (m = p.exec(body))) { const t = oneLine(stripTags(m[1])); if (t.length >= 40 && !LEAD_SKIP.test(t)) d = firstSentence(t, 200); }
    }
    return { title: clip(title, 90), desc: clip(d, 240), para: '', code: '' };
  }
  let body = html;
  const a = body.search(/class=["'][^"']*devsite-article-body/i);
  if (a > 0) body = body.slice(a); else { const b = body.search(/<article\b|<main\b/i); if (b > 0) body = body.slice(b); }
  const e = body.search(/devsite-content-footer|<\/article>|<\/main>|<footer\b/i);
  if (e > 0) body = body.slice(0, e);
  body = body.replace(/<(script|style|nav|aside|table|devsite-feedback|devsite-bookmark|devsite-thumb-rating|devsite-page-rating)\b[\s\S]*?<\/\1>/gi, ' ');
  const paras = [];
  let m;
  const pre = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = pre.exec(body)) && paras.join(' ').length < 160) {
    const t = oneLine(stripTags(m[1]));
    if (t.length >= 50 && !LEAD_SKIP.test(t)) paras.push(t);
  }
  const cm = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(body);
  return { title: clip(title, 90), desc: clip(desc, 240), para: clip(paras.join(' '), 300), code: cm ? codeText(cm[1]) : '' };
}
// A web page starts with <!doctype html> or <html> and ends with </html>; anything else is read as Markdown
const looksLikeHtml = (t) => /^\s*<(!doctype|html|head|body|\?xml)\b/i.test(String(t || '')) || /<\/html>\s*$/i.test(String(t || '').slice(-300));
const looksLikeMarkdown = (t) => !looksLikeHtml(t);
// Fenced code blocks (``` or ~~~), with what's inside them
const FENCE_RE = () => /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
// The Markdown copy of a Google docs page: maybe a header of "key: value" lines (description: among
// them), then the page. Many have no # title, and a # inside a code block is a comment, not a title.
function parseDocMd(md) {
  md = String(md || '').replace(/\r/g, '')
    .replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|<<[^>\n]+>>|\[TOC\]|\{:[^}\n]*\}/g, '')   // the docs site's own template tags
    .replace(/<!--[\s\S]*?-->/g, '');
  const meta = {};
  const setMeta = (l) => { const kv = /^([A-Za-z][\w ]{0,30}):\s*(.+)$/.exec(l.trim()); if (kv) meta[kv[1].toLowerCase().replace(/ /g, '_')] = kv[2].replace(/^["']|["']$/g, ''); };
  const fm = /^\s*---\n([\s\S]*?)\n---[ \t]*\n/.exec(md);
  if (fm) { fm[1].split('\n').forEach(setMeta); md = md.slice(fm[0].length); }
  else {
    // Header lines at the very top: Project:, Book:, or lower-case keys such as description:
    const lines = md.split('\n');
    let i = 0;
    while (i < lines.length && (!lines[i].trim() || /^(Project|Book|[a-z][a-z_]*)\s*:\s*\S/.test(lines[i].trim()))) { setMeta(lines[i]); i++; }
    md = lines.slice(i).join('\n');
  }
  const plain = md.replace(FENCE_RE(), '\n\n');
  const h = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(plain) || /^([^\n#>|*\-\[][^\n]{2,90})\n=+[ \t]*$/m.exec(plain);
  const title = oneLine(mdText(h ? h[1] : meta.title || meta.page_title || ''));
  const desc = oneLine(mdText(meta.description || ''));
  if (DEPRECATED.test(title + ' ' + desc)) return { skip: 'deprecated' };
  const body = h ? plain.slice(h.index + h[0].length) : plain;
  const f = FENCE_RE().exec(h ? md.slice(Math.max(0, md.indexOf(h[0]))) : md) || FENCE_RE().exec(md);
  const pre = !f && /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(body);
  const code = f ? codeText(f[3].replace(/&/g, '&amp;').replace(/</g, '&lt;')) : pre ? codeText(pre[1]) : '';
  // The opening paragraph or two, before the first heading: no notes, lists, tables or pictures
  const paras = [];
  const blocks = body.replace(/<(aside|table|pre|div|devsite-[\w-]+)\b[\s\S]*?<\/\1>/gi, '\n\n').split(/\n\s*\n/);
  for (let i = 0; i < blocks.length; i++) {
    let b = blocks[i].trim();
    if (!b) continue;
    if (/^#{1,6}\s/.test(b)) { if (paras.length) break; b = b.replace(/^#{1,6}\s[^\n]*\n?/, '').trim(); if (!b) continue; }
    if (/^(>|\||[-*+]\s|\d+[.)]\s|<|!\[|\[!\[|:\s|(\*\s*){3}|-{3,}|_{3,}|=+$)/.test(b) || /\n:\s/.test(b)) continue;
    let t = oneLine(mdText(b));
    if (/:$/.test(t)) t = t.replace(/(^|[.!?])[^.!?]*:$/, '$1').trim();   // "…lets you:" introduces a list, so it goes
    if (t.length >= 50 && !LEAD_SKIP.test(t)) paras.push(t);
    if (paras.join(' ').length >= 160) break;
  }
  return { title: clip(title, 90), desc: clip(desc, 240), para: clip(paras.join(' '), 300), code };
}
// Markdown to plain words: links to their text, images and emphasis gone, any HTML stripped
function mdText(t) {
  return stripTags(String(t || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1'));
}

// Code as it reads on the page: tags gone, indentation kept, at most 8 lines
function codeText(html) {
  const lines = decode(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\r/g, '').replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return '';
  const pad = Math.min.apply(null, lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length));
  let out = lines.map((l) => { const x = l.slice(pad).replace(/\s+$/, ''); return x.length > 240 ? x.slice(0, 239) + '…' : x; });   // Daily Drift shows up to 240 a line
  if (out.length > 8) out = out.slice(0, 8).concat(['…']);
  return out.join('\n').slice(0, 480);
}

// Google's Sheets function list: a table of type, name, syntax and description. The link to a
// function's own page sits in its "Learn more", so look for it anywhere in the row.
function parseFunctionList(html) {
  const out = [], at = {};
  let m;
  const row = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  while ((m = row.exec(String(html || '')))) {
    const cells = [];
    let c;
    const cell = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    while ((c = cell.exec(m[1]))) cells.push(c[1]);
    if (cells.length < 4) continue;
    const link = /href=["']([^"']+)["']/i.exec(cells[1]) || /href=["']([^"']+)["']/i.exec(cells[3]) || /href=["']([^"']+)["']/i.exec(m[1]);
    const name = oneLine(stripTags(cells[1])), syntax = oneLine(stripTags(cells[2])), desc = oneLine(stripTags(cells[3])).replace(/\s*Learn more\.?$/i, '');
    if (!name || !desc || /^(learn more|type)$/i.test(name)) continue;
    let u = link ? decode(link[1]) : '';
    if (/^\//.test(u)) u = 'https://support.google.com' + u;
    u = u.replace(/[?#].*$/, '');
    if (!/^https:\/\//.test(u) || u in at) u = 'https://support.google.com/docs/table/25273#' + encodeURIComponent(name);   // every function its own address
    at[u] = 1;
    out.push({ u, title: name + ' function', desc: clip(desc, 240), para: '', code: syntax, kind: oneLine(stripTags(cells[0])) });
  }
  return out;
}

// A README in Markdown: each ## or ### section, with its first paragraph and code. Commands under a
// "Commands" heading read as the command (clasp delete, not Delete).
function parseReadme(md, home) {
  const out = [];
  let parent = '';
  const secs = String(md || '').split(/\n(?=#{2,3} )/);
  secs.forEach((sec) => {
    const h = /^(#{2,3}) +(.+)/.exec(sec);
    if (!h) return;
    let head = h[2].replace(/[`*_]/g, '').trim();
    if (h[1] === '##') parent = head;
    if (/^(table of contents|contents|license|contributing|install(ation)?|build|develop\w*|faq|troubleshoot\w*|support|requirements?|debugging.*|.*filing issues|.*bugs?)$/i.test(head)) return;
    const body = sec.slice(h[0].length);
    let code = (/```[^\n]*\n([\s\S]*?)```/.exec(body) || [])[1] || '';
    if (!code) {
      // No code block: the section's own example commands, written inline
      const cmds = [];
      let c;
      const re = /`((?:clasp|npm|npx|gcloud) [^`\n]{1,80})`/g;
      while ((c = re.exec(body)) && cmds.length < 3) if (cmds.indexOf(c[1]) < 0) cmds.push(c[1]);
      code = cmds.join('\n');
    }
    // A heading that names a command (Clone, with clasp clone-script in its examples) reads as the command
    if (h[1] === '###' && /^[A-Za-z][\w-]*( [\w-]+)?$/.test(head) && !/^clasp\b/i.test(head)) {
      const word = head.split(' ')[0].toLowerCase().replace(/[^a-z-]/g, '');
      const named = word && new RegExp('\\bclasp (' + word + '[\\w-]*)', 'i').exec(body);
      if (named) head = 'clasp ' + named[1].toLowerCase();
      else if (/^commands?$/i.test(parent)) head = 'clasp ' + head.toLowerCase();
    }
    const text = body.replace(/```[\s\S]*?```/g, '\n').split(/\n\s*\n/).map((p) => oneLine(p.replace(/^[-*] +/gm, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, ''))).filter((p) => p.length >= 30 && !/^[#|<!]/.test(p));
    if (!text.length && !code) return;
    const slug = h[2].replace(/[`*_]/g, '').trim().toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ +/g, '-');
    out.push({ u: home + '#' + slug, title: clip(head, 90), desc: '', para: clip(text.slice(0, 2).join(' '), 300), code: code ? codeText(code.replace(/&/g, '&amp;').replace(/</g, '&lt;')) : '' });
  });
  return out;
}

// An llms.txt index: "- [Title](https://…md): summary" lines (ai.google.dev's end .md.txt); the pages
// themselves are Markdown. A summary that only says whose docs these are is no summary.
function parseLlms(txt, s) {
  const out = [];
  let m;
  const re = /^\s*[-*]\s*(?:\[([^\]]*)\])?\((https:\/\/[^)\s]+)\)(?::\s*(.+))?$/gm;
  while ((m = re.exec(String(txt || '')))) {
    const u = m[2], desc = oneLine(decode(m[3] || '')), path = u.replace(/^https:\/\/[^\/]+/, '');
    if (s && (s.only ? !s.only.test(u) : s.path && path.indexOf(s.path) !== 0)) continue;   // only the subject's own docs, not its API reference
    if (/\?/.test(u)) continue;   // the same page again for an older API (?generate-content=true)
    if (LEARN_SKIP.test(path) || /\b(legacy|deprecat\w*)\b/i.test(desc) || /\b(api reference|reference|llms|resource index)\b/i.test(m[1] || '')) continue;
    const isMd = /\.md(\.txt)?$/i.test(u);
    // Fetch the Markdown, but link people to the page itself
    out.push({ u, link: u.replace(/(\.md(\.txt)?)+$/i, ''), title: clip(oneLine(decode(m[1] || '')), 90), desc: /^documentation for google/i.test(desc) ? '' : clip(desc, 240), needsFetch: isMd });
  }
  if (!out.length) throw new Error('no pages listed');
  return out;
}
function parseMdPage(md) {
  md = String(md || '');
  if (looksLikeHtml(md)) throw new Error('a web page, not Markdown');
  return parseDocMd(md);
}

// Term, Tip and Did you know from the day's pages, a brief item and a video
function makeLearnSet(s, pages, briefItems, videos, at) {
  const take = (test) => { const i = pages.findIndex(test); return i < 0 ? null : pages.splice(i, 1)[0]; };
  const tip = take((x) => !!x.code) || take(() => true);
  const term = take((x) => !x.code) || take(() => true);
  if (!tip && !term) return null;
  const used = [];
  const read = { text: s.kind === 'help' || s.kind === 'sheetfns' || s.summaryOnly ? 'Read on Google' : 'Read the docs', url: '' };
  const part = (label, x, useDesc) => {
    const p = { label, title: x.title, body: useDesc ? x.desc || x.para : x.para || x.desc, links: [{ text: read.text, url: x.u }] };
    if (x.code && label === 'Tip') p.code = x.code;
    return p;
  };
  const parts = [];
  if (term) parts.push(part('Term', term, true));
  if (tip) parts.push(part('Tip', tip, false));
  // Did you know: something new from the brief for this subject, else another of the day's pages
  const news = briefItems.find((it) => used.indexOf(it.id) < 0 && (it.s || '').length >= 30);   // one with something to say
  if (news) {
    used.push(news.id);
    parts.push({ label: 'Did you know', title: clip(news.t, 90), body: clip(news.s || '', 240), links: [{ text: /^(gcp|gemapi|asnotes|wsdev|appsheet|antigravity)$/.test(news.src) ? 'Read the release note' : 'Read the post', url: news.u }] });
  } else {
    const more = take(() => true);
    if (more) parts.push(part('Did you know', more, true));
  }
  if (parts.length < 2) return null;
  // A video for the Tip: the newest matching one from Google's channels, else a search for one
  const v = videos.find((x) => used.indexOf(x.id) < 0);
  const watch = v ? { text: 'Watch', url: v.u } : { text: 'Find a video', url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent((/^Google /.test(s.n) ? '' : 'Google ') + s.n + ' tutorial') };
  if (v) used.push(v.id);
  (parts.find((p) => p.label === 'Tip') || parts[0]).links.push(watch);
  const docsCredit = s.credit || DOCS_CREDIT(s.docs);
  return { id: hashId('learn|' + s.id + '|' + parts.map((p) => p.links[0].url).join('|')), s: s.id, d: at, credit: docsCredit, parts, used };
}
