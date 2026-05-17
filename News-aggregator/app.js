/**
 * app.js — Personal News Aggregator
 *
 * What this file does, in plain English:
 *  1. When the page loads, it fetches data/articles.json (the file that
 *     GitHub Actions updates every hour).
 *  2. It builds the category and source filter controls from whatever
 *     categories/sources are actually in the data (no hard-coding).
 *  3. It renders the article list — newest first, unread articles shown
 *     prominently, read articles faded.
 *  4. It remembers which articles you've read by saving their IDs to
 *     localStorage — a small storage area built into every browser that
 *     persists between visits on your device.
 *  5. It lets you mark articles read/unread, mark everything read, and
 *     toggle whether read articles are shown or hidden.
 */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const DATA_URL = './data/articles.json';

// Keys used to store your preferences in localStorage.
// (Changing these will reset your saved state — so don't change them.)
const LS_READ_IDS   = 'news-read-ids';    // JSON array of article IDs you've read
const LS_HIDE_READ  = 'news-hide-read';   // 'true' | 'false'
const LS_CATEGORY   = 'news-category';    // last selected category

// Safety cap: only keep this many read-IDs in localStorage.
// (Prevents the storage from growing without bound over many months.)
const MAX_READ_IDS_STORED = 3000;


// ── App State ─────────────────────────────────────────────────────────────────
// Everything the app needs to remember while it is running lives here.

let allArticles    = [];        // every article from data/articles.json
let readIds        = new Set(); // IDs of articles the user has marked read
let hideRead       = false;     // whether read articles are hidden
let activeCategory = 'All';     // currently selected category filter
let activeSource   = 'All';     // currently selected source filter


// ── localStorage Helpers ──────────────────────────────────────────────────────
// localStorage stores strings only, so we JSON-encode our data.

function loadPersistedState() {
  try {
    const stored = localStorage.getItem(LS_READ_IDS);
    if (stored) {
      readIds = new Set(JSON.parse(stored));
    }
  } catch {
    readIds = new Set();
  }

  hideRead       = localStorage.getItem(LS_HIDE_READ) === 'true';
  activeCategory = localStorage.getItem(LS_CATEGORY)  || 'All';
}

function saveReadIds() {
  try {
    let arr = [...readIds];
    // Trim oldest entries if we're over the cap
    if (arr.length > MAX_READ_IDS_STORED) {
      arr = arr.slice(arr.length - MAX_READ_IDS_STORED);
      readIds = new Set(arr);
    }
    localStorage.setItem(LS_READ_IDS, JSON.stringify(arr));
  } catch {
    // localStorage can be full or disabled — fail silently
  }
}

function savePrefs() {
  try {
    localStorage.setItem(LS_HIDE_READ, String(hideRead));
    localStorage.setItem(LS_CATEGORY,  activeCategory);
  } catch { /* ignore */ }
}


// ── Time Formatting ───────────────────────────────────────────────────────────
// Converts a Date object into a human-friendly string like "3h ago" or "14 May".

function formatAge(date) {
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 0)      return 'just now';   // clock skew / future date
  if (diffSeconds < 60)     return 'just now';
  if (diffSeconds < 3600)   return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400)  return `${Math.floor(diffSeconds / 3600)}h ago`;
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`;
  // Older than a week — show the actual date
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}


// ── HTML Escaping ─────────────────────────────────────────────────────────────
// Always escape user-supplied strings before putting them into innerHTML.
// (Prevents stray < or & characters from breaking the page layout.)

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}


// ── Data Loading ──────────────────────────────────────────────────────────────

async function loadData() {
  const statusEl = document.getElementById('status-text');
  statusEl.textContent = 'Loading…';

  // Add ?t=timestamp to bypass any aggressive browser caching
  const url = DATA_URL + '?t=' + Date.now();

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    allArticles = Array.isArray(data.items) ? data.items : [];

    // Show when the data was last refreshed by GitHub Actions
    if (data.updated) {
      const updatedAt = new Date(data.updated);
      statusEl.textContent =
        `${allArticles.length.toLocaleString()} articles · updated ${formatAge(updatedAt)}`;
    } else if (allArticles.length === 0) {
      statusEl.textContent = 'No articles yet — trigger the first run in GitHub Actions';
    } else {
      statusEl.textContent = `${allArticles.length.toLocaleString()} articles`;
    }

    buildFilters();
    render();

  } catch (err) {
    console.error('Failed to load articles.json:', err);
    statusEl.textContent = '⚠ Could not load articles';

    document.getElementById('article-list').innerHTML = `
      <div class="empty-state">
        <strong>Could not load articles</strong>
        If this is your first time, go to your GitHub repo,
        click the <em>Actions</em> tab, select
        <em>Fetch News Feeds</em>, and click <em>Run workflow</em>.
        Articles will appear within a minute.
      </div>`;
  }
}


// ── Filter Building ───────────────────────────────────────────────────────────
// Reads the categories and sources from the loaded articles and builds the
// filter controls dynamically (so you never need to edit this file when
// you add a new category or source to feeds.json).

function buildFilters() {
  buildCategoryButtons();
  buildSourceDropdown();
}

function buildCategoryButtons() {
  const container = document.getElementById('category-filters');

  // Collect unique categories that are actually present in the data
  const cats = ['All', ...[...new Set(allArticles.map(a => a.category))].sort()];

  // If the saved category no longer exists in the data, reset to All
  if (!cats.includes(activeCategory)) activeCategory = 'All';

  container.innerHTML = '';
  for (const cat of cats) {
    const btn = document.createElement('button');
    btn.className  = 'filter-btn' + (cat === activeCategory ? ' active' : '');
    btn.textContent = cat;
    btn.setAttribute('aria-pressed', String(cat === activeCategory));
    btn.addEventListener('click', () => {
      if (activeCategory === cat) return;   // already selected, nothing to do
      activeCategory = cat;
      activeSource   = 'All';              // reset source when category changes
      savePrefs();
      buildCategoryButtons();
      buildSourceDropdown();
      render();
    });
    container.appendChild(btn);
  }
}

function buildSourceDropdown() {
  const select = document.getElementById('source-select');

  // Only list sources that appear in the currently active category
  const relevantArticles = activeCategory === 'All'
    ? allArticles
    : allArticles.filter(a => a.category === activeCategory);

  const sources = ['All', ...[...new Set(relevantArticles.map(a => a.source))].sort()];

  // If the saved source is no longer valid, reset
  if (!sources.includes(activeSource)) activeSource = 'All';

  select.innerHTML = '';
  for (const src of sources) {
    const opt = document.createElement('option');
    opt.value       = src;
    opt.textContent = src;
    opt.selected    = (src === activeSource);
    select.appendChild(opt);
  }
}


// ── Filtering ─────────────────────────────────────────────────────────────────

function getFilteredArticles() {
  return allArticles.filter(a => {
    if (activeCategory !== 'All' && a.category !== activeCategory) return false;
    if (activeSource   !== 'All' && a.source   !== activeSource)   return false;
    if (hideRead && readIds.has(a.id))                             return false;
    return true;
  });
}

// Count unread in the current category+source filter, ignoring hideRead
// (so the badge shows how many are unread even when hideRead is off)
function countUnread() {
  return allArticles.filter(a => {
    if (activeCategory !== 'All' && a.category !== activeCategory) return false;
    if (activeSource   !== 'All' && a.source   !== activeSource)   return false;
    return !readIds.has(a.id);
  }).length;
}


// ── Rendering ─────────────────────────────────────────────────────────────────
// Builds the full article list from scratch each time filters change.
// For individual read/unread toggles we update just the affected card in place
// (so the page doesn't flicker when you tap a single article).

function render() {
  const list    = document.getElementById('article-list');
  const badge   = document.getElementById('unread-badge');
  const hideBtn = document.getElementById('hide-read-btn');

  // Update the unread badge
  const unread = countUnread();
  badge.textContent = unread > 0 ? `${unread} unread` : '';

  // Update the hide-read button label and highlight
  hideBtn.textContent = hideRead ? 'Show read' : 'Hide read';
  hideBtn.classList.toggle('active', hideRead);

  const filtered = getFilteredArticles();

  if (filtered.length === 0) {
    const msg = allArticles.length === 0
      ? '<strong>No articles yet</strong>Trigger the first GitHub Actions run — see the README for how.'
      : hideRead
        ? '<strong>All caught up!</strong>You\'ve read everything in this view.<br>Tap "Show read" to see them again.'
        : '<strong>Nothing here</strong>Try a different filter.';

    list.innerHTML = `<div class="empty-state">${msg}</div>`;
    list.removeAttribute('aria-busy');
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const article of filtered) {
    fragment.appendChild(buildCard(article));
  }

  list.innerHTML = '';
  list.appendChild(fragment);
  list.removeAttribute('aria-busy');
}

function buildCard(article) {
  const isRead = readIds.has(article.id);
  const card   = document.createElement('article');
  card.className   = 'article-card' + (isRead ? ' is-read' : '');
  card.dataset.id  = article.id;

  const pubDate = new Date(article.published);
  const timeStr = formatAge(pubDate);
  // Full date shown on hover / as the <time> datetime attribute
  const isoDate = pubDate.toISOString();
  const fullDate = pubDate.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  card.innerHTML = `
    <div class="card-meta">
      <span class="card-source">${esc(article.source)}</span>
      <span class="card-category">${esc(article.category)}</span>
      <time class="card-time" datetime="${esc(isoDate)}" title="${esc(fullDate)}">${esc(timeStr)}</time>
    </div>

    <h2 class="card-title">
      <a class="card-link"
         href="${esc(article.link)}"
         target="_blank"
         rel="noopener noreferrer"
         aria-label="${esc(article.title)} — opens in new tab"
      >${esc(article.title)}</a>
    </h2>

    ${article.summary
      ? `<p class="card-summary">${esc(article.summary)}</p>`
      : ''}

    <div class="card-footer">
      <button class="read-btn"
              data-id="${esc(article.id)}"
              aria-label="${isRead ? 'Mark as unread' : 'Mark as read'}"
              title="${isRead ? 'Mark as unread' : 'Mark as read'}"
      >${isRead ? '● Read' : '○ Unread'}</button>
    </div>`;

  // Tapping the headline link marks the article as read (opening in new tab)
  card.querySelector('.card-link').addEventListener('click', () => {
    setReadState(article.id, true);
  });

  // The read/unread button toggles without opening the article
  card.querySelector('.read-btn').addEventListener('click', e => {
    e.stopPropagation();
    setReadState(article.id, !readIds.has(article.id));
  });

  return card;
}


// ── Read / Unread State ───────────────────────────────────────────────────────
// Updates one article's read state and refreshes the affected card in place
// (without re-rendering the whole list, which would be jarring).

function setReadState(id, markAsRead) {
  if (markAsRead) {
    readIds.add(id);
  } else {
    readIds.delete(id);
  }
  saveReadIds();

  const card = document.querySelector(`.article-card[data-id="${id}"]`);
  if (!card) {
    // Card isn't in the DOM right now — full render will handle it
    render();
    return;
  }

  if (hideRead && markAsRead) {
    // Smoothly collapse and remove the card
    animateRemove(card, render);
  } else {
    // Just update the card's appearance in place
    card.classList.toggle('is-read', markAsRead);
    const btn = card.querySelector('.read-btn');
    if (btn) {
      btn.textContent  = markAsRead ? '● Read' : '○ Unread';
      btn.setAttribute('aria-label', markAsRead ? 'Mark as unread' : 'Mark as read');
    }
    // Update the badge count
    const badge  = document.getElementById('unread-badge');
    const unread = countUnread();
    badge.textContent = unread > 0 ? `${unread} unread` : '';
  }
}

function animateRemove(el, onDone) {
  // Snapshot the height so we can animate to zero
  el.style.maxHeight = el.offsetHeight + 'px';
  el.style.overflow  = 'hidden';
  el.style.opacity   = '0';
  el.style.transition = 'max-height 0.25s ease, opacity 0.18s ease, margin 0.25s ease, padding 0.25s ease';

  // Next frame: collapse
  requestAnimationFrame(() => {
    el.style.maxHeight = '0';
    el.style.marginTop = '0';
    el.style.marginBottom = '0';
    el.style.paddingTop = '0';
    el.style.paddingBottom = '0';
  });

  el.addEventListener('transitionend', () => {
    el.remove();
    if (typeof onDone === 'function') onDone();
  }, { once: true });
}


// ── Event Wiring ──────────────────────────────────────────────────────────────
// Connect all the buttons and controls once the page has loaded.

function wireEvents() {
  // Refresh button — re-fetches articles.json
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadData();
  });

  // "Mark all read" — marks every article that passes the current filters
  document.getElementById('mark-all-btn').addEventListener('click', () => {
    const toMark = getFilteredArticles();
    // If hideRead is on, re-fetch the full filtered set including read ones
    const fullFiltered = allArticles.filter(a => {
      if (activeCategory !== 'All' && a.category !== activeCategory) return false;
      if (activeSource   !== 'All' && a.source   !== activeSource)   return false;
      return true;
    });
    for (const a of fullFiltered) readIds.add(a.id);
    saveReadIds();
    render();
  });

  // "Hide read" / "Show read" toggle
  document.getElementById('hide-read-btn').addEventListener('click', () => {
    hideRead = !hideRead;
    savePrefs();
    render();
  });

  // Source dropdown
  document.getElementById('source-select').addEventListener('change', e => {
    activeSource = e.target.value;
    render();
  });
}


// ── Boot ──────────────────────────────────────────────────────────────────────

function init() {
  loadPersistedState();
  wireEvents();
  loadData();
}

// Wait for the HTML to be ready before touching the DOM
document.addEventListener('DOMContentLoaded', init);
