# doGet(news)

What’s new across Google, once a day.

A calm daily brief for Google developers, in Material 3 with light and dark themes: Google Cloud release notes, Google Workspace Updates, the Gemini API changelog and Google's own blogs, tagged by track (Workspace, Cloud, AI, Dev tools) and stage (new model, GA, preview, deprecated, breaking). Each update links to Google's own page and docs, with matching videos from Google's YouTube channels and articles from the Google Cloud Community on Medium.

Live at **https://quick-sheet.github.io/doGetNews/**. Free, no accounts, no tracking. Independent and not affiliated with Google.

## How it works

- **Once a day**, between 7 and 8am UK time, an Apps Script time trigger reads the sources, builds `brief.json` and saves it into this repo through GitHub's API.
- **The app** is static files on GitHub Pages. It only ever reads `brief.json`, so however many people use it, it costs one Apps Script run a day. There is no web app and no refresh button that could call the script.
- Updates stay for two weeks; videos and articles for a month. A source that fails one day keeps its earlier updates.

## Set up (once)

1. **Repo and Pages**: create `quick-sheet/doGetNews` (public), upload every file from the zip, turn on Pages (Deploy from a branch, `main`, `/ (root)`).
2. **GitHub token**: github.com → your photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Name it `doGet(news) daily brief`, choose the longest expiry offered, Resource owner `quick-sheet`, Repository access: Only select repositories → `doGetNews`, Repository permissions → **Contents: Read and write**. Copy the token.
3. **Apps Script**: script.google.com → New project, rename it `doGet(news)`. Paste `apps-script/Code.gs` over the default file. In Project Settings tick "Show appsscript.json manifest file in editor" and paste `apps-script/appsscript.json`. Under Script Properties add `GITHUB_TOKEN` with the token.
4. In the editor choose **setup** and press **Run**, then approve. It sets the daily trigger and publishes the first brief straight away. The log ends with "Published: … updates".

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
| `core.js` | Filtering, grouping and dates, with no page in it |
| `sw.js` | Works offline and picks up new releases |
| `manifest.webmanifest`, `icon*` | Install to the home screen |
| `brief.json` | Written by Apps Script every morning. Don't upload or edit it by hand |
| `apps-script/Code.gs`, `appsscript.json` | The daily run. Pasted into Apps Script, not run from here |

## Good to know

- **Sources** are listed at the top of `Code.gs` and in the app under Settings → Sources, each with today's status. To add a feed, add a line to `SOURCES`.
- **The token expires.** When it does, the brief stops updating and the app says the brief is old. Make a new token and replace `GITHUB_TOKEN` in Script Properties. The Apps Script Executions page shows the exact error.
- **Want to check without publishing?** Run `preview` in the editor: it logs what today's brief would contain.
- **Android sound on every launch** with "Tap to copy the URL for this app": that's Chrome's Full screen site controls notification. Long-press it and turn that category off.
- Your LinkedIn link goes in the `LINKEDIN` constant near the top of the script in `index.html`.
- The name is a nod to `doGet()`, where every Apps Script web app begins. This one deliberately has none.
