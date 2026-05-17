# My Personal News Aggregator

A personal news reader that collects articles from all your favourite RSS feeds
and shows them in one clean list — works great on iPhone, installs to your Home
Screen, and is hosted for free on GitHub Pages.

---

## How it works (the big picture)

Think of the project as three parts working together:

| Part | What it is | What it does |
|------|-----------|--------------|
| **Feed list** | `feeds.json` | The list of sources you want to follow. You edit this file to add or remove sources. |
| **Fetcher** | `scripts/fetch_feeds.py` | A Python script that runs automatically on GitHub every hour. It visits every source in your feed list, downloads the latest articles, merges them into one list, and saves them to `data/articles.json`. |
| **Web app** | `index.html` + `app.js` + `style.css` | The page your iPhone opens. It reads `data/articles.json` and shows everything in a clean, filterable list. All your read/unread state is stored on your device (never sent anywhere). |

---

## First-time setup — step by step

### Step 1 — Create a GitHub repository

1. Go to [github.com](https://github.com) and sign in (or create a free account).
2. Click the **+** button in the top-right → **New repository**.
3. Give it a name, e.g. `my-news`. Set it to **Public** (required for free GitHub Pages hosting).
4. Click **Create repository**.

### Step 2 — Upload the project files

On your new repository's page:

1. Click **Add file → Upload files**.
2. Drag the entire contents of this project folder into the upload area.
   Make sure to include the hidden folders (`.github/` and `data/`).
   > **Tip for Mac users:** Press **⌘ + Shift + .** in Finder to show hidden files before dragging.
3. Click **Commit changes**.

### Step 3 — Enable GitHub Pages

1. In your repository, click the **Settings** tab (top of the page).
2. In the left sidebar, click **Pages**.
3. Under *Build and deployment*, set **Source** to `Deploy from a branch`.
4. Set **Branch** to `main` and **Folder** to `/ (root)`, then click **Save**.
5. After about a minute, GitHub shows a URL like:
   `https://your-username.github.io/my-news/`
   That is your app. Bookmark it.

### Step 4 — Run the fetcher for the first time

The fetcher runs automatically every hour, but right now `articles.json` is empty.
Trigger it manually so you don't have to wait:

1. Click the **Actions** tab in your repository.
2. Click **Fetch News Feeds** in the left panel.
3. Click the grey **Run workflow** button on the right → **Run workflow** (green).
4. Wait about 60–90 seconds. A green tick appears when it's done.
5. Reload your GitHub Pages URL — articles should now be showing!

> The fetcher also generates the app icons (`icon-192.png` and `icon-512.png`)
> on its first run and commits them to the repository automatically.

### Step 5 — Install to your iPhone Home Screen

1. Open your GitHub Pages URL in **Safari** on your iPhone.
2. Tap the **Share** button (the square with an arrow pointing up — at the
   bottom of the screen in Safari).
3. Scroll down the share sheet and tap **Add to Home Screen**.
4. Give it a name — "My News" works well — then tap **Add**.
5. You now have an app icon on your Home Screen. It opens full-screen, with no
   browser address bar, just like a native app.

---

## Using the app

| Feature | How to use it |
|---------|--------------|
| **Read an article** | Tap the headline. It opens in a new tab and marks the article as read. |
| **Mark read / unread** | Tap the **○ Unread** or **● Read** button on any card to toggle it without opening the link. |
| **Mark everything read** | Tap **Mark all read** in the header (marks all articles in the current filter view). |
| **Hide articles you've read** | Tap **Hide read** in the header. Tap **Show read** to bring them back. |
| **Filter by category** | Tap any pill in the category strip (News, Sport, Business, etc.). Tap **All** to reset. |
| **Filter by source** | Use the **Source** dropdown. When a category is selected, only the sources in that category are listed. |
| **Refresh** | Tap the **↻** button in the top-right. This re-fetches `articles.json` (but doesn't re-run the fetcher — that's on GitHub's hourly schedule). |

Your read/unread state is saved on your device and persists between visits.

---

## How to add or remove news sources

Open `feeds.json` in your repository. You can edit it directly on GitHub:

1. Click `feeds.json` in the file list.
2. Click the **pencil ✏️** icon (top-right of the file view).
3. Make your changes (see below).
4. Click **Commit changes…** → **Commit changes**.

The workflow is also set to trigger automatically whenever `feeds.json` changes,
so new sources will appear within a minute or two.

### Adding a source

Copy any existing line in the `feeds` array and change the values:

```json
{ "name": "My New Source", "url": "https://example.com/feed.xml", "category": "News" }
```

- **`name`** — What you want it called in the app.
- **`url`** — The RSS or Atom feed URL. (See tips below for finding these.)
- **`category`** — Which filter tab it appears under. Use an existing category
  (`News`, `Sport`, `Business`, `Ideas`, `Cars`, `Local`) or make up a new one —
  a new filter button will appear automatically.

> **JSON rules:** Every entry must be separated by a comma — except the last one
> in the list, which must *not* have a comma after it. All text must be in double
> quotes. If you're unsure, paste the file into [jsonlint.com](https://jsonlint.com)
> to check it.

### Removing a source

Delete the entire `{ "name": …, "url": …, "category": … }` line for that source.

### Finding feed URLs

- **News websites** — Most have a link like `/rss`, `/feed`, or `/rss.xml`. Try
  adding `/rss` to the site's homepage URL, or search "[site name] RSS feed".
- **Reddit** — Add `.rss` to any subreddit URL:
  `https://www.reddit.com/r/worldnews/.rss`
  For newest-first instead of "hot", use `/new.rss` at the end.
- **YouTube channels** — You need the channel's ID (a string starting with `UC`).
  Format: `https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxxxxx`
  Ask Claude Code to help you find the right URL for a channel.
- **Podcasts** — Every podcast is already an RSS feed. Find the URL from the
  show's website or a podcast directory like [Podchaser](https://www.podchaser.com).

---

## How often does it update?

The fetcher runs once an hour (at 18 minutes past each hour, GitHub time).
Each run takes about 1–2 minutes. The header shows when the data was last updated.

You can also trigger it manually any time from the **Actions** tab.

---

## Project file reference

```
my-news/
│
├── feeds.json              ← YOUR FEED LIST — the only file you regularly edit
│
├── index.html              ← The web app (the page your browser opens)
├── style.css               ← Visual design (colours, fonts, layout)
├── app.js                  ← App logic (filtering, read state, rendering)
├── manifest.json           ← Tells the iPhone "this is a real app"
│
├── icon-192.png            ← App icon — auto-generated on the first Actions run
├── icon-512.png            ← App icon (larger) — same
│
├── .nojekyll               ← Stops GitHub from post-processing the files
│
├── data/
│   └── articles.json       ← Auto-updated every hour — do not edit by hand
│
├── scripts/
│   ├── fetch_feeds.py      ← The fetcher script that GitHub Actions runs
│   └── requirements.txt    ← The two Python libraries the fetcher needs
│
└── .github/
    └── workflows/
        └── fetch-feeds.yml ← The schedule definition ("run every hour")
```

---

## Troubleshooting

**"Could not load articles" on first visit**
The fetcher hasn't run yet. Go to **Actions → Fetch News Feeds → Run workflow**.

**A feed never shows articles**
The feed URL may have changed. Open the URL in a browser; if you see an error,
the address is wrong. The notes inside `feeds.json` flag the feeds most likely
to change over time.

**A Reddit feed shows nothing**
Reddit requires a proper `User-Agent` header (already sent by this fetcher). If
a specific subreddit is still empty, double-check the URL ends in `/.rss`.

**The Actions workflow fails with a red ✗**
Click the failed run to see the log. The most common causes are a typo in
`feeds.json` (check with [jsonlint.com](https://jsonlint.com)) or a temporary
network problem (just re-run it).

**My edits to feeds.json aren't showing up**
Editing `feeds.json` in GitHub triggers the workflow automatically. Wait 2 minutes
and refresh. If nothing appears, check the Actions tab for errors.

**The app is slow to update after I've read things**
Read/unread state is saved instantly in your device's local storage — it never
needs a network round-trip. The article *list* updates on GitHub's hourly schedule.
