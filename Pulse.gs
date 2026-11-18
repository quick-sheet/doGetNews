/**
 * doGet(news) · pulse — an anonymous visit counter that messages you on Telegram.
 *
 * This is a SEPARATE Apps Script project from the one that writes the brief. It is deployed as a web
 * app, so its address is public, and keeping it apart means the brief's GitHub token stays in a script
 * nothing outside can reach.
 *
 * It counts visits, never people. Each beacon is added to a running total and thrown away: no
 * identifiers are sent or stored, nothing is kept per visitor, and no two beacons are ever joined up.
 * All it can ever tell you is how many, on what, roughly where, and what was popular.
 *
 * Set up (once):
 *   1. Telegram: message @BotFather, /newbot, and copy the token. Message your new bot once, then
 *      message @userinfobot to get your own numeric chat id.
 *   2. Project Settings → Script Properties: TELEGRAM_TOKEN and TELEGRAM_CHAT.
 *   3. Run setupPulse (approve when asked). It checks Telegram, makes the daily trigger and says hello.
 *   4. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Copy the /exec address.
 *   5. Paste that address into PULSE_URL in the app's index.html, and upload it.
 *
 * After changing anything here, Deploy → Manage deployments → edit → Version: New version, or the web
 * app keeps running the old code.
 */

const PULSE = {
  key: 'dgn1',        // beacons without this are ignored, so stray traffic to the address counts for nothing
  app: 'doGet(news)',
  hour: 8,            // the digest goes out between 8 and 9am UK time
  tz: 'Europe/London',
  maxVisit: 3600,     // a visit counts as at most an hour, so one forgotten tab can't skew the average
  topLinks: 5,        // sites named in the digest
  keepLinks: 40,      // sites tallied at all
  quiet: true,        // true: say nothing on a day with no visits. false: send the digest anyway
};

const DEVICES = ['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Linux', 'Other'];
// Where a visit was, as roughly as the browser will say: the region of its language, else its time zone
const PLACES = { GB: 'UK', US: 'US', IE: 'Ireland', IN: 'India', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand',
  DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', PT: 'Portugal', PL: 'Poland',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', CH: 'Switzerland', AT: 'Austria', BE: 'Belgium',
  BR: 'Brazil', MX: 'Mexico', AR: 'Argentina', ZA: 'South Africa', NG: 'Nigeria', KE: 'Kenya', EG: 'Egypt',
  AE: 'UAE', SA: 'Saudi Arabia', IL: 'Israel', TR: 'Türkiye', RU: 'Russia', UA: 'Ukraine',
  JP: 'Japan', KR: 'South Korea', CN: 'China', HK: 'Hong Kong', TW: 'Taiwan', SG: 'Singapore',
  MY: 'Malaysia', ID: 'Indonesia', TH: 'Thailand', VN: 'Vietnam', PH: 'Philippines', PK: 'Pakistan', BD: 'Bangladesh' };

/* ======================================================================
   Run these from the editor
   ====================================================================== */

// Run once, and again after changing the time: checks Telegram, makes the daily trigger, says hello.
function setupPulse() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('TELEGRAM_TOKEN') || !p.getProperty('TELEGRAM_CHAT')) {
    console.log('Put TELEGRAM_TOKEN and TELEGRAM_CHAT in Project Settings → Script Properties first.');
    return;
  }
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'digest').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('digest').timeBased().everyDays(1).atHour(PULSE.hour).nearMinute(0).inTimezone(PULSE.tz).create();
  const ok = send('<b>' + esc(PULSE.app) + ' · pulse</b>\nCounting from now. The daily summary arrives at about '
    + (PULSE.hour % 12 || 12) + (PULSE.hour < 12 ? 'am' : 'pm') + ' UK time.');
  console.log(ok ? 'Telegram works and the daily trigger is set. Deploy as a web app next, then paste the /exec address into the app.'
    : 'The trigger is set, but Telegram turned the message away. Check TELEGRAM_TOKEN and TELEGRAM_CHAT, and that you have messaged the bot once.');
}

// Sends the summary so far and starts a fresh count, for when you don't want to wait until morning
function pulseNow() {
  digest();
  console.log('Sent, and counting fresh from now.');
}

// What the counter holds at this moment, without sending or clearing anything
function pulsePeek() {
  const st = read();
  console.log(st.opens ? summary(st, Date.now()).replace(/<[^>]+>/g, '') : 'No visits counted yet.');
  return st;
}

/* ======================================================================
   The web app: one beacon in, one tally up
   ====================================================================== */

function doPost(e) {
  try { take(e); } catch (err) { /* a count is never worth an error */ }
  return ContentService.createTextOutput('ok');
}
// Opening the address in a browser shows nothing but this
function doGet() { return ContentService.createTextOutput('ok'); }

function take(e) {
  let b = null;
  try { b = JSON.parse((e && e.postData && e.postData.contents) || 'null'); } catch (err) { b = null; }
  if (!b || b.k !== PULSE.key) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return;   // busy: this one goes uncounted rather than queue up
  try {
    const st = read();
    if (b.t === 'open') {
      st.opens++;
      bump(st.dev, DEVICES.indexOf(String(b.dev)) >= 0 ? b.dev : 'Other');
      bump(st.geo, place(b.lang, b.tz));
      bump(st.pwa, b.pwa ? 'installed' : 'browser');
      if (!st.pinged) { st.pinged = 1; send('👋 <b>' + esc(PULSE.app) + '</b> — someone is using it.'); }
    } else if (b.t === 'end') {
      if (b.first) st.visits++;
      st.secs += Math.min(PULSE.maxVisit, Math.max(0, Math.round(+b.dur || 0)));
      const seen = {};
      (Array.isArray(b.links) ? b.links : []).slice(0, 8).forEach((h) => {
        const host = String(h || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 60);
        if (host && host.indexOf('.') > 0 && !seen[host]) { seen[host] = 1; bump(st.links, host); }   // a site counts once a visit
      });
      trim(st.links, PULSE.keepLinks);
    } else return;
    write(st);
  } finally { lock.releaseLock(); }
}

/* ======================================================================
   The daily summary
   ====================================================================== */

function digest() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  let st = null;
  try {
    st = read();
    write(blank(Date.now()));
  } finally { lock.releaseLock(); }
  if (st && (st.opens || !PULSE.quiet)) send(summary(st, Date.now()));
}

// "doGet(news) · Tue 17 Nov to Wed 18 Nov", then the numbers, each line left out when there's nothing in it
function summary(st, to) {
  const day = (ms) => Utilities.formatDate(new Date(ms), PULSE.tz, 'EEE d MMM');
  const from = day(st.from), till = day(to);
  const lines = ['<b>' + esc(PULSE.app) + ' · pulse</b>', from === till ? from : from + ' → ' + till, ''];
  lines.push(plural(st.opens, 'open', 'opens') + (top(st.dev).length ? ' · ' + top(st.dev, 4).join(', ') : ''));
  const where = top(st.geo, 4);
  if (where.length) lines.push(where.join(' · '));
  const bits = [];
  if (st.visits) bits.push('avg visit ' + clock(Math.round(st.secs / st.visits)));
  if (st.pwa.installed) bits.push(st.pwa.installed + ' from the home screen');
  if (bits.length) lines.push(bits.join(' · '));
  const taps = Object.keys(st.links).reduce((n, k) => n + st.links[k], 0);
  if (taps) lines.push(plural(taps, 'link tapped', 'links tapped') + ' — ' + top(st.links, PULSE.topLinks).join(', '));
  return lines.join('\n');
}

/* ======================================================================
   Small helpers
   ====================================================================== */

const KEY = 'PULSE_COUNT';
const blank = (at) => ({ from: at, opens: 0, visits: 0, secs: 0, dev: {}, geo: {}, pwa: {}, links: {}, pinged: 0 });
// Nothing is written until there is something to count
function read() {
  let st = null;
  try { st = JSON.parse(PropertiesService.getScriptProperties().getProperty(KEY) || 'null'); } catch (e) { st = null; }
  if (!st || typeof st !== 'object' || !st.from) st = blank(Date.now());
  ['dev', 'geo', 'pwa', 'links'].forEach((k) => { if (!st[k] || typeof st[k] !== 'object') st[k] = {}; });
  return st;
}
const write = (st) => PropertiesService.getScriptProperties().setProperty(KEY, JSON.stringify(st));
const bump = (map, k) => { if (k) map[k] = (map[k] || 0) + 1; };
// The biggest first, as "Name n" (the count left off when it's one)
function top(map, n) {
  return Object.keys(map).sort((a, b) => map[b] - map[a] || (a < b ? -1 : 1)).slice(0, n || 99)
    .map((k) => esc(k) + (map[k] > 1 ? ' ' + map[k] : ''));
}
function trim(map, keep) {
  const keys = Object.keys(map);
  if (keys.length <= keep) return;
  keys.sort((a, b) => map[b] - map[a]).slice(keep).forEach((k) => { delete map[k]; });
}
function place(lang, tz) {
  const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(String(lang || ''));
  if (m) { const c = m[1].toUpperCase(); return PLACES[c] || c; }
  const seg = String(tz || '').split('/').pop().replace(/_/g, ' ');
  return seg || 'Somewhere';
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const clock = (s) => (s >= 60 ? Math.floor(s / 60) + 'm' + (s % 60 ? (s % 60) + 's' : '') : s + 's');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function send(text) {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('TELEGRAM_TOKEN'), chat = p.getProperty('TELEGRAM_CHAT');
  if (!token || !chat) return false;
  try {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', muteHttpExceptions: true,
      payload: { chat_id: String(chat), text: text, parse_mode: 'HTML', disable_web_page_preview: 'true' },
    });
    const ok = r.getResponseCode() === 200;
    if (!ok) console.warn('Telegram answered ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
    return ok;
  } catch (e) {
    console.warn('Telegram could not be reached: ' + e.message);
    return false;
  }
}
