# FitTrack

A personal exercise tracker that runs as a home-screen app on iPhone (a Progressive Web App).
Each person uses it on their own phone with their own data.

- **Exercises**: a library you add to whenever you find a new move. Each exercise picks what
  gets logged per set: reps, weight, time (with a countdown timer), and whether it's done on each side.
  Add form notes and a link to the video you learned it from.
- **Plans**: any number, any mix of exercises, each with its own target sets/reps/time/weight and
  rest. Pick the days of the week. Optional **ramp-up** (e.g. 50% of reps in weeks 1–2, then 100%).
  Several plans can be active at once.
- **Workouts**: one tap logs a set at the target, or use "Custom…" to log the real numbers.
  There's a rest timer between sets, a countdown with a beep for timed holds, and tap a set to fix it.
- **Progress**: streaks, a 13-week calendar heatmap, how often each plan's scheduled days were done,
  per-exercise charts (total reps, heaviest weight, total time), personal bests, and history.
- **Sync & backup**: optional Google Drive sync to a private app folder in each person's own Drive,
  plus export/import of a backup file.

Starter data includes the "100 Reps Daily" plan (4 moves, ramping from ~50 to 100 reps each,
Mon–Sat), a "Basic Strength" plan and a "Daily Stretch" plan (both paused), and about 20 common exercises.
Everything can be edited or deleted.

## Try it on your PC

```
node tools/serve.mjs
```

Then open http://localhost:8080. Use your browser's device toolbar (F12 → phone icon) to see the phone layout.

## Put it on your iPhones

The app has to be served over HTTPS. GitHub Pages does this for free:

1. Create a free account at https://github.com and a new **public** repository, e.g. `fittrack`.
2. Upload everything in this folder (drag-and-drop on the repo page works).
3. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   choose `main` and `/ (root)`, then Save. After about a minute the app is at
   `https://<your-username>.github.io/fittrack/`.
4. On each iPhone, open that address in **Safari**, tap **Share → Add to Home Screen**.

Open it from the home-screen icon from then on. Note: the home-screen app keeps its data separately
from Safari, so log workouts in the installed app.

**Deploying changes:** upload the changed files, and bump `VERSION` in `sw.js` (e.g. `fittrack-v2`)
so phones pick up the new version. The app shows "Update ready" and uses it next time it's opened.

## Google Drive sync (optional, one-time setup)

Without this, data lives only on each phone. Use Settings → Export now and then as a backup.
With it, each person's data is backed up to their own Google Drive and moves with them to a new phone.

1. Go to https://console.cloud.google.com and create a project (e.g. "FitTrack").
2. **APIs & Services → Library**: search "Google Drive API" and click **Enable**.
3. **Google Auth Platform** (OAuth consent screen): click **Get started**. App name "FitTrack",
   your email as support email, Audience: **External**. Finish.
4. **Audience → Test users**: add your Gmail address and your wife's.
   (Leaving the app in "Testing" is fine for personal use.)
5. **Clients → Create client**: type **Web application**. Under **Authorized JavaScript origins**
   add `https://<your-username>.github.io` (and `http://localhost:8080` for testing on your PC).
   Create it and copy the **Client ID** (ends in `.apps.googleusercontent.com`).
6. Paste the Client ID into `js/config.js` before uploading, or paste it into each phone's
   app under **Settings → Google Drive sync → Google Client ID**.
7. In the app: **Settings → Connect Google Drive**, and sign in with *your own* Google account.
   Your wife does the same on her phone with hers.

How syncing works: the app syncs automatically when opened and closed while the Google sign-in is fresh.
Google grants access for an hour at a time. After that, a **Back up to Google Drive** button appears
on the Today screen when there are unsaved changes. One tap re-syncs, usually without a password.
If two devices edit the same thing, the most recent edit wins.

The data file lives in Drive's hidden app-data area. It isn't visible in your Drive file list and
the app can't see any of your other Drive files.

## Files

```
index.html             app page
manifest.webmanifest   home-screen install info
sw.js                  offline cache (bump VERSION when deploying changes)
css/app.css            styles (light + dark mode)
js/app.js              router, events, background sync
js/store.js            data model, schedule/ramp logic, merge
js/seed.js             starter exercises and plans
js/sync.js             Google Drive sync
js/ui.js               sheets, timers, toast, icons
js/views/*.js          one file per screen
tools/serve.mjs        local test server
tools/make-icons.mjs   regenerates icons/*.png
```

## Ideas for later

- Shared view: see each other's streaks (needs a shared Drive file or a small backend).
- Weekly summary / charts by plan; body weight and measurements log.
- Quick-log a single exercise without a plan.
- Reminders. iOS supports web push for home-screen apps, but that needs a small server.
