# doGet(news)

What’s new across Google, twice a day.

A calm daily brief for Google developers, in Material 3 with light and dark themes: Google Cloud, Workspace, Apps Script and AppSheet release notes, the Gemini API and Antigravity changelogs, Firebase and Google's own blogs, tagged by stage (new model, GA, preview, deprecated, breaking). Choose Today, Yesterday, This week, This month or This quarter. Follow any of 13 topics (GCP, GWS, Google Apps, Gemini Enterprise, Google AI Studio, Gemini & AI, Google Antigravity, Apps Script, AppSheet, Firebase, Firestore, BigQuery, Dev tools) and scroll back through three months. Each update links to Google's own page and docs, with matching videos from Google's YouTube channels and articles from the Google Cloud Community on Medium.

Live at **https://quick-sheet.github.io/doGetNews/**. Free, no accounts, no tracking. Independent and not affiliated with Google.

## How it works

- **Once a day**, between 7 and 8am UK time, an Apps Script time trigger reads the sources and saves two files into this repo through GitHub's API: `brief.json` (the last two weeks) and `archive.json` (the rest of the three months).
- **The app** is static files on GitHub Pages. It opens on `brief.json` and loads `archive.json` in the background, so however many people use it, it costs one Apps Script run a day. There is no web app and no refresh button that could call the script.
- Updates, videos and articles stay for three months. A source that fails one day keeps its earlier updates. Feeds only hold their recent posts, so the history fills in a day at a time.
- **Learn** has its own run at about 6:30am. It reads Google's own docs and help pages for 19 subjects and saves `learn.json`: one new set a day per subject of Term, Tip (with its code sample) and Did you know (something new from the brief, or another page). Google's developer docs are CC BY 4.0 with code under Apache 2.0, so each set credits and links back to them; Help Center pages, Workspace Admin Help (now at knowledge.workspace.google.com) and the Gemini API docs (now inside AI Studio) contribute only their title and Google's one-line summary. Pages used are remembered in Script Properties, so nothing repeats until a subject's pages have all had a turn. If a site turns Learn away one morning (Google's Help Center sometimes answers 429, too many requests), that subject's set comes from a small reserve of pages kept the day before. Sets stay for a month.
- **Two floating bars that follow the reading.** Reading down draws the bottom bar in to just its icons; coming back up opens it out again, and brings the time frame and Topics in under the top pill, so the filters are reachable from anywhere on the page without going back to the top.
- **Learn opens on Daily Drift's own screen** (its embed mode, `?embed=dogetnews`), which doGet(news) sends one set at a time, cut to the lengths Daily Drift shows (its Release 16 contract, in the project as `claude/daily-drift-embed.md`); pulling down there asks for another, with no network call. If Daily Drift can't be reached, a plain card in doGet(news)'s style shows the same set.
- **Brief me** (optional): anyone can paste their own Gemini API key under Settings → Brief me with Gemini. A Brief me button then appears next to Topics. Gemini writes a spoken briefing of exactly what's showing (the period, topics and New only), in Headlines (about 2 minutes) or Detailed (about 5), and reads it aloud in one of six Gemini voices, with lock-screen controls. Each part links back to the updates it covers. The key stays on that phone and is sent only to Google, so it never uses your credits. The day's briefs and recordings are kept on the phone, so playing one again costs nothing. Nothing about it touches Apps Script or GitHub.

## Set up (once)

1. **Repo and Pages**: create `quick-sheet/doGetNews` (public), upload every file from the zip, turn on Pages (Deploy from a branch, `main`, `/ (root)`).
2. **GitHub token**: github.com → your photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Name it `doGet(news) daily brief`, choose the longest expiry offered, Resource owner `quick-sheet`, Repository access: Only select repositories → `doGetNews`, Repository permissions → **Contents: Read and write**. Copy the token.
3. **Apps Script**: script.google.com → New project, rename it `doGet(news)`. Paste `apps-script/Code.gs` over the default file. In Project Settings tick "Show appsscript.json manifest file in editor" and paste `apps-script/appsscript.json`. Under Script Properties add `GITHUB_TOKEN` with the token.
4. In the editor choose **setup** and press **Run**, then approve. It sets the triggers (Learn at about 6:30am, the brief at about 7am and 7pm UK time) and publishes the first brief straight away. Run it again whenever the times change. The log ends with "Published: … updates".
5. Choose **learn** and press **Run**, so Learn has its first sets now rather than tomorrow morning. The log ends with "Learn: … new sets".

No deployment is needed: the script has no web app.

## Install

- **Android (Chrome)**: open the live link, tap **Install** on the banner (or ⋮ → Install app).
- **iPhone (Safari)**: open the live link, tap Share (under ⋯ on iOS 26), then **Add to Home Screen**.

## Share

Send the live link. Everyone sees the same brief; stars, themes and settings stay on each phone.

## Update

Upload the changed files with **Add file → Upload files** and commit. Every release bumps both markers together: `core.js?v=N` in `index.html` and `dogetnews-vN` in `sw.js`. Fully close and reopen the app to pick it up.

If `Code.gs` changes, paste the new version into the Apps Script editor and save. Nothing to redeploy.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The whole app: layout, styles and script |
| `core.js` | Topics, filtering, grouping and dates, with no page in it |
| `gemini.js` | Brief me: what Gemini is asked, reading its reply, the voice, and plain-words errors |
| `sw.js` | Works offline and picks up new releases |
| `manifest.webmanifest`, `icon*`, `apple-touch-icon.png` | Install to the home screen |
| `logo.png` | The rainbow cloud in the header and welcome sheet |
| `brief.json`, `archive.json`, `learn.json` | Written by Apps Script every morning. Don't upload or edit them by hand |
| `apps-script/Code.gs`, `appsscript.json` | The daily run. Pasted into Apps Script, not run from here |
| `apps-script-pulse/Pulse.gs` | Optional. The separate visit counter that messages Telegram |

## The pulse (optional)

An anonymous visit counter that messages you on Telegram, so you know whether anyone is using it. It is off until you set it up, and the app sends nothing while `PULSE_URL` in `index.html` is empty.

It counts visits, never people. The app sends two fire-and-forget beacons — one on opening (device, the region of the browser's language or time zone, home screen or browser) and one on leaving (how long, and which sites were opened from it). `Pulse.gs` adds each to a running total and throws it away. No identifiers are sent or stored, nothing is kept per visitor, and no two beacons are ever joined up, so all it can ever tell you is how many, on what, roughly where, and what was popular.

You get a "someone is using it" ping on the first visit of the day, and a summary each morning at about 8am UK time:

> **doGet(news) · pulse**
> Tue 17 Nov → Wed 18 Nov
>
> 13 opens · iPhone 9, Android 3, Mac
> UK 9 · US 3 · India
> avg visit 2m10s · 4 from the home screen
> 12 links tapped — cloud.google.com 6, firebase.google.com 3

Set it up with the steps at the top of `apps-script-pulse/Pulse.gs`. It is a **separate** Apps Script project on purpose: it is deployed as a web app, so its address is public, and keeping it apart means the brief's GitHub token stays in a script nothing outside can reach. While the pulse is on, the app says so in its footer and in About.

## Good to know

- **Why twice a day:** most of Google's posts and release notes go out in US working hours (about 4pm to 1am UK time). The 7am run catches the end of the US day, and the 7pm run its morning, so Today fills the same day instead of everything landing under Yesterday.

- **Sources** are listed at the top of `Code.gs` and in the app under Settings → Sources, each with today's status. To add a feed, add a line to `SOURCES`.
- **The token expires.** When it does, the brief stops updating and the app says the brief is old. Make a new token and replace `GITHUB_TOKEN` in Script Properties. The Apps Script Executions page shows the exact error.
- **Want to check without publishing?** Run `preview` in the editor: it logs what today's brief would contain. `learnPreview` does the same for Learn. If it says FAIL for any subject, run `learnDebug` as it is: it looks closely at each subject that preview said FAIL for and logs what Apps Script sees (to look at just one, put its id, such as `bigquery`, in the empty quotes at the end of its first line).
- **Learn's subjects** are listed in `LEARN_SUBJECTS` near the end of `Code.gs`, and in the app under Settings → Learn sources with each one's status. To add one, add a line with its starting page and the part of the site its pages live under.
- **Android sound on every launch** with "Tap to copy the URL for this app": that's Chrome's Full screen site controls notification. Long-press it and turn that category off.
- Your LinkedIn link goes in the `LINKEDIN` constant near the top of the script in `index.html`.
- The name is a nod to `doGet()`, where every Apps Script web app begins. This one deliberately has none.
