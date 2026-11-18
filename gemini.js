/* doGet(news) × Gemini: "Brief me", on the person's own Gemini API key.
   Gemini writes a spoken briefing of the updates on screen, then reads it aloud in one of its voices.
   Everything here runs in the browser and talks only to Google's Gemini API (generateContent, the
   stable interface; the Interactions API is still in beta). The key is sent only to Google. */
(function (root) {
  'use strict';
  const API = 'https://generativelanguage.googleapis.com/v1beta/';
  const VOICES = [
    { id: 'Charon', d: 'Informative' }, { id: 'Kore', d: 'Firm' }, { id: 'Aoede', d: 'Breezy' },
    { id: 'Sulafat', d: 'Warm' }, { id: 'Iapetus', d: 'Clear' }, { id: 'Puck', d: 'Upbeat' },
  ];
  // Used when the list of models can't be read; the list itself is preferred, as names change often
  const FALLBACK = { text: 'gemini-flash-latest', tts: ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'] };
  const MAX_ITEMS = 150;    // a quarter can hold hundreds: the most important 150 go in
  const FIRST = 520;        // characters in the first spoken part, so the voice starts in seconds
  const NEXT = 1100;        // characters in each part after that
  const LENGTHS = {
    short: { n: 'Headlines', words: 280, ask: 'About 280 words in all: a one-sentence opening, then 3 to 5 themes of one to three sentences each, then a one-sentence close.' },
    long: { n: 'Detailed', words: 750, ask: 'About 750 words in all: a short opening, then 5 to 8 themes, each a short paragraph saying what changed, who it matters to and anything to act on (with dates), then a short close.' },
  };
  const STYLE = 'Read this aloud as a calm, warm, unhurried morning news briefing:\n\n';

  /* ---------- Choosing models from the key's own list ---------- */
  const ver = (n) => { const m = /gemini-(\d+)(?:\.(\d+))?/.exec(n); return m ? +m[1] * 100 + (+m[2] || 0) : 0; };
  const pre = (n) => (/preview|exp/.test(n) ? 1 : 0);
  function pickModels(json) {
    const all = ((json && json.models) || [])
      .filter((m) => (m.supportedGenerationMethods || ['generateContent']).indexOf('generateContent') >= 0)
      .map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
    const other = /tts|image|live|audio|embed|vision|lite|thinking|learnlm|robotics|computer|native|nano|aqa|gemma|veo|imagen|lyria/;
    let text = all.indexOf('gemini-flash-latest') >= 0 ? 'gemini-flash-latest' : '';
    if (!text) {
      const flash = all.filter((n) => /^gemini-\d+(\.\d+)?-flash(-[\w.-]+)?$/.test(n) && !other.test(n.replace(/-preview.*$/, '')));
      flash.sort((a, b) => pre(a) - pre(b) || ver(b) - ver(a) || a.length - b.length);
      text = flash[0] || all.filter((n) => /flash/.test(n) && !other.test(n))[0] || FALLBACK.text;
    }
    const tts = all.filter((n) => /^gemini-.*tts/.test(n));
    tts.sort((a, b) => (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0) || pre(a) - pre(b) || ver(b) - ver(a));
    return { text, tts: tts.length ? tts.slice(0, 4) : FALLBACK.tts.slice(), at: Date.now() };
  }

  /* ---------- What Gemini is asked ---------- */
  const one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  // The updates in, numbered, so Gemini can say which ones each part of the brief covers
  function choose(items) {
    if (items.length <= MAX_ITEMS) return items.slice();
    const top = items.slice().sort((a, b) => (b.r || 0) - (a.r || 0) || b.d - a.d).slice(0, MAX_ITEMS);
    return top.sort((a, b) => b.d - a.d || (b.r || 0) - (a.r || 0));
  }
  function request(items, o) {
    o = o || {};
    const used = choose(items || []);
    const len = LENGTHS[o.len] || LENGTHS.short;
    const line = (it, i) => {
      const stage = o.stage ? o.stage(it.st) : '';
      const what = (it.p || []).slice(0, 2).join(', ') || o.track && o.track(it.tr) || 'Google';
      const src = o.src ? o.src(it) : '';
      return `${i + 1}. ${stage ? '[' + stage + '] ' : ''}${what}: ${one(it.t)}${it.s ? '. ' + one(it.s) : ''}${src ? ' (' + src + ')' : ''}`;
    };
    const system = [
      'You are the voice of doGet(news), a calm daily brief on what Google shipped for developers: Google Cloud, Google Workspace, Apps Script, AppSheet, Firebase, Gemini and Google Antigravity.',
      'Write a spoken briefing of the updates you are given, for a developer listening on their phone.',
      'Use only what the updates say. Never add facts, dates, numbers, opinions or advice that are not in them, and never guess at what something means.',
      'Group related updates into themes. Lead with what matters most: new models, general availability, deprecations and breaking changes (with their dates), then previews and smaller changes.',
      'Write for the ear: short sentences, plain words, no lists, no markdown, no links, no emoji, no item numbers in the text. Say product names the way people say them. British English.',
      'Reply with JSON only.',
    ].join(' ');
    const user = [
      `The brief: ${one(o.scope) || 'today'}${o.topics ? '. Topics followed: ' + one(o.topics) : ''}.`,
      `${used.length} update${used.length === 1 ? '' : 's'}${items.length > used.length ? `, the most important ${used.length} of ${items.length}` : ''}.`,
      `Length: ${len.ask}`,
      'Return this JSON: {"title": "a short headline for the whole brief", "intro": "the opening", "sections": [{"heading": "a few words", "text": "what to say", "ids": [the numbers of the updates this part covers]}], "outro": "the close"}',
      '',
      'Updates:',
      used.map(line).join('\n'),
    ].join('\n');
    return { system, user, used };
  }

  /* ---------- Reading the reply ---------- */
  function parseBrief(text, used) {
    used = used || [];
    const raw = String(text || '').trim();
    const t = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    let j = null;
    try { j = JSON.parse(t); } catch (e) {
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); } catch (e2) { j = null; } }
    }
    const clean = (s) => one(String(s == null ? '' : s).replace(/[*_`#]+/g, '').replace(/\s*\[(\d+(,\s*\d+)*)\]/g, ''));
    if (!j || typeof j !== 'object' || Array.isArray(j)) {
      // Not JSON after all: paragraphs, the first as the opening
      const paras = raw.split(/\n\s*\n/).map(clean).filter((p) => p && !/^[{}[\]]/.test(p));
      if (!paras.length) return null;
      return { title: 'Your brief', intro: paras[0], sections: paras.slice(1).map((p) => ({ h: '', text: p, ids: [] })), outro: '' };
    }
    const sections = (Array.isArray(j.sections) ? j.sections : []).map((s) => {
      s = s || {};
      const ids = [];
      (Array.isArray(s.ids) ? s.ids : []).forEach((n) => {
        const it = used[(parseInt(n, 10) || 0) - 1];
        if (it && ids.indexOf(it.id) < 0) ids.push(it.id);
      });
      return { h: clean(s.heading || s.h || s.title), text: clean(s.text || s.body || s.content), ids };
    }).filter((s) => s.text);
    const out = { title: clean(j.title) || 'Your brief', intro: clean(j.intro || j.opening), sections, outro: clean(j.outro || j.close || j.closing) };
    return out.intro || sections.length ? out : null;
  }

  // The brief in spoken parts: a short first one so the voice starts quickly, then longer ones.
  // Each part knows which sections it reads (-1 the opening, -2 the close).
  function parts(b) {
    const bits = [];
    if (b.intro) bits.push({ text: b.intro, sec: -1 });
    b.sections.forEach((s, i) => bits.push({ text: s.text, sec: i }));
    if (b.outro) bits.push({ text: b.outro, sec: -2 });
    const out = [];
    bits.forEach((x) => {
      const cur = out[out.length - 1];
      let join = false;
      if (cur) {
        const len = cur.text.length + x.text.length + 2;
        // The first part: the opening and the first section, then only what still fits; a short close joins the part before it
        if (out.length === 1) join = (cur.secs.length === 1 && cur.secs[0] === -1) || len <= FIRST;
        else join = len <= NEXT || (x.sec === -2 && len <= NEXT + 300);
      }
      if (join) { cur.text += '\n\n' + x.text; cur.secs.push(x.sec); } else out.push({ text: x.text, secs: [x.sec] });
    });
    return out;
  }

  /* ---------- Sound ---------- */
  function b64bytes(b64) {
    const s = atob(String(b64 || '').replace(/[\r\n\s]/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  // 16-bit mono PCM, as Gemini sends it, wrapped as a WAV file the phone can play
  function wav(pcm, rate) {
    rate = rate || 24000;
    const n = pcm.length, out = new Uint8Array(44 + n), v = new DataView(out.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n, true);
    out.set(pcm, 44);
    return out;
  }
  const secondsOf = (wavBytes) => Math.max(0, (wavBytes.length - 44) / 2 / (new DataView(wavBytes.buffer, wavBytes.byteOffset).getUint32(24, true) || 24000));

  /* ---------- What went wrong, in plain words ---------- */
  function problem(status, j) {
    const er = (j && j.error) || {};
    const msg = String(er.message || ''), st = String(er.status || '');
    const det = Array.isArray(er.details) ? er.details : [];
    const all = msg + ' ' + JSON.stringify(det);
    const reason = (det.find((d) => d && d.reason) || {}).reason || '';
    const retry = (det.find((d) => d && d.retryDelay) || {}).retryDelay;
    const e = new Error('');
    e.status = status; e.detail = msg;
    if (!status) { e.kind = 'offline'; e.message = 'Couldn’t reach Gemini. Check your connection and try again.'; }
    else if (reason === 'API_KEY_INVALID' || /api key not valid|api_key_invalid|invalid api key|api key expired/i.test(all)) { e.kind = 'key'; e.message = 'Gemini didn’t accept that key. Check it in Settings.'; }
    else if (/location is not supported|not (yet )?available in your (country|region)|user location/i.test(all)) { e.kind = 'region'; e.message = 'Google doesn’t offer the Gemini API where you are just now.'; }
    else if (status === 429 || st === 'RESOURCE_EXHAUSTED') {
      e.kind = 'quota';
      e.zero = /limit:\s*0\b/.test(all);
      e.daily = e.zero || /per ?day|PerDay|daily/i.test(all);
      e.wait = retry ? Math.round(parseFloat(retry) * 1000) : 0;
      e.message = e.daily ? 'You’ve used today’s free Gemini allowance for this. It resets tomorrow, or you can turn on billing in Google AI Studio.'
        : 'Gemini’s free tier needs a moment. Try again in a minute.';
    } else if (status === 403 || st === 'PERMISSION_DENIED') { e.kind = 'denied'; e.message = 'Google turned the key away here. If you restricted it, allow the Generative Language API and https://quick-sheet.github.io/*.'; }
    else if (status === 404 || st === 'NOT_FOUND') { e.kind = 'model'; e.message = 'That Gemini model isn’t available to this key.'; }
    else if (status >= 500) { e.kind = 'busy'; e.message = 'Gemini is busy just now. Try again in a minute.'; }
    else if (status === 400 && /voice|speech_?config|prebuilt|unknown name|cannot find field|invalid json payload/i.test(all)) { e.kind = 'form'; e.message = 'Gemini didn’t understand the voice settings.'; }
    else { e.kind = 'other'; e.message = 'Gemini couldn’t do that just now (' + status + ').'; }
    return e;
  }
  const emptyReply = (why) => { const e = new Error(why === 'blocked' ? 'Gemini declined to write this one. Try a different period or topics.' : 'Gemini sent back nothing to use. Try again.'); e.kind = why; return e; };

  function textOf(j) {
    const c = j && j.candidates && j.candidates[0];
    if (!c) throw emptyReply(j && j.promptFeedback && j.promptFeedback.blockReason ? 'blocked' : 'empty');
    const t = ((c.content && c.content.parts) || []).filter((p) => p && !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    if (!t.trim()) throw emptyReply(/SAFETY|BLOCK|PROHIBITED/.test(c.finishReason || '') ? 'blocked' : 'empty');
    return t;
  }
  function audioOf(j) {
    const c = j && j.candidates && j.candidates[0];
    const p = ((c && c.content && c.content.parts) || []).map((x) => x && (x.inlineData || x.inline_data)).find((x) => x && x.data);
    if (!p) throw emptyReply('empty');
    const mime = String(p.mimeType || p.mime_type || '');
    const bytes = b64bytes(p.data);
    if (/wav/i.test(mime) || (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)) return bytes;
    return wav(bytes, +((/rate=(\d+)/.exec(mime) || [])[1]) || 24000);
  }

  /* ---------- Talking to Gemini ---------- */
  function client(key, opts) {
    opts = opts || {};
    const f = opts.fetch || ((u, o) => fetch(u, o));
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const aborted = () => { const e = new Error('stopped'); e.name = 'AbortError'; return e; };
    async function call(path, body, signal) {
      let res;
      try {
        res = await f(API + path, { method: body ? 'POST' : 'GET', signal,
          headers: Object.assign({ 'x-goog-api-key': key }, body ? { 'Content-Type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined });
      } catch (e) { if (e && e.name === 'AbortError') throw e; throw problem(0, null); }
      let j = null;
      try { j = await res.json(); } catch (e) { j = null; }
      if (!res.ok) throw problem(res.status, j);
      return j;
    }
    // A moment's busyness (a 503, or a per-minute limit) is waited out, twice at most
    async function patient(fn, signal) {
      for (let k = 0; ; k++) {
        try { return await fn(); } catch (e) {
          if (e.name === 'AbortError') throw e;
          const brief = e.kind === 'busy' || (e.kind === 'quota' && !e.daily);
          if (!brief || k >= 2 || (e.wait || 0) > 65e3) throw e;
          await sleep(e.wait || 1500 * (k + 1));
          if (signal && signal.aborted) throw aborted();
        }
      }
    }
    async function models(signal) {
      let page = '', list = [];
      for (let k = 0; k < 5; k++) {
        const j = await call('models?pageSize=1000' + (page ? '&pageToken=' + encodeURIComponent(page) : ''), null, signal);
        list = list.concat((j && j.models) || []);
        page = j && j.nextPageToken;
        if (!page) break;
      }
      return pickModels({ models: list });
    }
    async function write(model, req, signal) {
      const body = { systemInstruction: { parts: [{ text: req.system }] }, contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } };
      return textOf(await patient(() => call('models/' + encodeURIComponent(model) + ':generateContent', body, signal), signal));
    }
    // Two ways of naming the voice: the long-standing one, and the shorter one newer models document
    const voiceBody = (text, voice, form) => ({ contents: [{ role: 'user', parts: [{ text: STYLE + text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: form === 'short' ? { voiceConfig: { voice } } : { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } });
    async function speakWith(model, voice, text, form, signal) {
      const go = (fm) => patient(() => call('models/' + encodeURIComponent(model) + ':generateContent', voiceBody(text, voice, fm), signal), signal);
      const first = form || 'long';
      try { return { wav: audioOf(await go(first)), form: first }; } catch (e) {
        if (e.kind !== 'form' && !(e.kind === 'other' && e.status === 400)) throw e;
        const other = first === 'short' ? 'long' : 'short';
        return { wav: audioOf(await go(other)), form: other };
      }
    }
    // Reads with the first voice model this key can use; one with no free allowance, or that's gone, hands on to the next
    async function speak(list, voice, text, form, signal) {
      let last = null;
      for (let i = 0; i < list.length; i++) {
        try { return Object.assign(await speakWith(list[i], voice, text, form, signal), { model: list[i] }); } catch (e) {
          if (e.name === 'AbortError') throw e;
          last = e;
          if (!(e.kind === 'model' || (e.kind === 'quota' && e.zero) || e.kind === 'form')) throw e;
        }
      }
      throw last || emptyReply('empty');
    }
    return { models, write, speak, call };
  }

  const Gem = { API, VOICES, LENGTHS, FALLBACK, MAX_ITEMS, FIRST, NEXT, STYLE, pickModels, request, parseBrief, parts, wav, b64bytes, secondsOf, problem, textOf, audioOf, client };
  if (typeof module !== 'undefined' && module.exports) module.exports = Gem;
  else root.Gem = Gem;
})(typeof self !== 'undefined' ? self : this);
