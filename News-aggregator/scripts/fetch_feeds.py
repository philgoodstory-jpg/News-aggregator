#!/usr/bin/env python3
"""
fetch_feeds.py — Personal News Aggregator: Feed Fetcher
========================================================
Reads feeds.json from the project root, downloads every feed one at a time
(with a polite pause between requests), combines all the articles, removes
duplicates, sorts them newest-first, and saves the result to data/articles.json.

Also generates the two PNG app icons (icon-192.png, icon-512.png) if they
don't already exist — they only need to be generated once.

Run this script directly to test it locally:
    cd /path/to/your/project
    pip install feedparser requests
    python scripts/fetch_feeds.py
"""

import hashlib
import json
import os
import re
import struct
import time
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser
import requests

# ── Configuration ─────────────────────────────────────────────────────────────

# How many articles to keep in the output file (newest first).
MAX_ITEMS = 500

# Ignore articles older than this many days.
KEEP_DAYS = 30

# How long to wait between feed requests (be a polite internet citizen).
PAUSE_SECONDS = 1.5

# How long to wait for a feed to respond before giving up.
REQUEST_TIMEOUT = 20

# This header is required by Reddit, and is polite to send everywhere.
# It identifies who is making the request. If you fork this project,
# update the GitHub URL to your own repository.
USER_AGENT = (
    "PersonalNewsAggregator/1.0 "
    "(private RSS reader; github.com/philgoodstory/my-news; "
    "polite bot, contact via GitHub)"
)

# ── File Paths ────────────────────────────────────────────────────────────────

# __file__ is this script; .parent is scripts/, .parent.parent is the project root.
ROOT     = Path(__file__).parent.parent
FEEDS    = ROOT / "feeds.json"
OUTPUT   = ROOT / "data" / "articles.json"
ICON_192 = ROOT / "icon-192.png"
ICON_512 = ROOT / "icon-512.png"


# ── Icon Generator ────────────────────────────────────────────────────────────
# Uses only Python's built-in libraries — no Pillow or other image library needed.
# Draws a dark-navy square with three white horizontal bars (like a reading list).

def _make_png(filepath: Path, size: int) -> None:
    """Write a simple PNG icon to disk using only the Python standard library."""

    # Colour palette
    BG_R,  BG_G,  BG_B  = 27,  38,  59   # Dark navy  (#1B263B)
    BAR_R, BAR_G, BAR_B = 255, 255, 255  # White

    # Bar geometry — three horizontal bars at 32 %, 50 %, 68 % of the icon height
    bar_h      = max(size // 18, 2)          # height of each bar
    bar_w_full = int(size * 0.58)            # width of bar 1 and 3
    bar_w_mid  = int(bar_w_full * 0.72)      # width of bar 2 (shorter, more varied)
    x0         = int(size * 0.21)            # left edge of all bars
    bar_rows   = [int(size * 0.32), int(size * 0.50), int(size * 0.68)]
    bar_widths = [bar_w_full, bar_w_mid, bar_w_full]

    def pixel_rgb(x: int, y: int):
        for row, w in zip(bar_rows, bar_widths):
            if row <= y < row + bar_h and x0 <= x < x0 + w:
                return BAR_R, BAR_G, BAR_B
        return BG_R, BG_G, BG_B

    # Build the raw (uncompressed) image data: one filter byte per row, then RGB pixels
    raw = bytearray()
    for y in range(size):
        raw += b'\x00'                       # PNG filter type: None
        for x in range(size):
            r, g, b = pixel_rgb(x, y)
            raw += bytes([r, g, b])

    # Helper to wrap data in a PNG chunk (length + tag + data + CRC)
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFF_FFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    png_bytes = (
        b'\x89PNG\r\n\x1a\n'                                        # PNG signature
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))  # header
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))              # image data
        + chunk(b'IEND', b'')                                       # end marker
    )

    filepath.write_bytes(png_bytes)
    print(f"  ✓ Generated {filepath.name}  ({size}×{size} px)")


def ensure_icons() -> None:
    """Generate the PNG icons if they do not already exist."""
    for path, size in [(ICON_192, 192), (ICON_512, 512)]:
        if not path.exists():
            print(f"Generating icon: {path.name}")
            _make_png(path, size)


# ── Date Helpers ──────────────────────────────────────────────────────────────

def parse_date(entry) -> datetime:
    """
    Pull a timezone-aware datetime from a feedparser entry.
    feedparser gives us time as a Python time.struct_time in UTC under several
    possible attribute names. We try each in order of preference.
    """
    for attr in ("published_parsed", "updated_parsed", "created_parsed"):
        t = getattr(entry, attr, None)
        if t:
            try:
                return datetime(*t[:6], tzinfo=timezone.utc)
            except Exception:
                pass
    # No date found — treat as "just now" so it sorts to the top
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    """Format a datetime as an ISO-8601 string (the format JavaScript understands)."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Text Helpers ──────────────────────────────────────────────────────────────

def strip_html(text: str) -> str:
    """Remove HTML tags and tidy up whitespace."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)        # remove tags
    text = re.sub(r"&nbsp;", " ", text)          # common HTML entity
    text = re.sub(r"&amp;",  "&", text)
    text = re.sub(r"&lt;",   "<", text)
    text = re.sub(r"&gt;",   ">", text)
    text = re.sub(r"&quot;", '"', text)
    text = re.sub(r"\s+",    " ", text).strip()  # collapse whitespace
    return text


def best_summary(entry) -> str:
    """
    Extract the most useful summary text from a feed entry.
    Atom feeds store the body in entry.content; RSS uses entry.summary.
    We try both and take the longer one (usually richer), then cap at 400 chars.
    """
    candidates = []

    # Atom 'content' field (a list of dicts)
    for c in getattr(entry, "content", []):
        t = strip_html(c.get("value", ""))
        if t:
            candidates.append(t)

    # RSS 'summary' / 'description' fields
    for attr in ("summary", "description"):
        t = strip_html(entry.get(attr, ""))
        if t:
            candidates.append(t)

    if not candidates:
        return ""

    # Pick the longest candidate (most informative), cap it
    text = max(candidates, key=len)
    if len(text) > 400:
        text = text[:397].rsplit(" ", 1)[0] + "…"
    return text


def make_id(link: str, title: str) -> str:
    """
    Create a short, stable unique identifier for an article.
    We use the URL as the key (so the same article from two feeds is de-duplicated).
    If there is no URL, we fall back to a hash of the title.
    """
    key = link.strip() if link.strip() else f"title:{title}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


# ── Feed Fetching & Parsing ───────────────────────────────────────────────────

def fetch_one_feed(feed_meta: dict) -> list[dict]:
    """
    Download and parse a single feed. Returns a list of article dicts.
    If anything goes wrong, prints a warning and returns an empty list
    so the rest of the feeds are unaffected.
    """
    name     = feed_meta["name"]
    url      = feed_meta["url"]
    category = feed_meta["category"]

    headers = {
        "User-Agent": USER_AGENT,
        # Tell the server we accept RSS and Atom formats
        "Accept": (
            "application/rss+xml, application/atom+xml, "
            "application/xml, text/xml, */*"
        ),
    }

    # ── Step 1: Download the raw feed ────────────────────────────────────────
    try:
        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()   # raises an exception for 4xx / 5xx responses
    except requests.exceptions.Timeout:
        print(f"  ✗ {name}: timed out after {REQUEST_TIMEOUT}s — skipping")
        return []
    except requests.exceptions.HTTPError as e:
        print(f"  ✗ {name}: HTTP {e.response.status_code} — skipping")
        return []
    except Exception as e:
        print(f"  ✗ {name}: could not connect — {e} — skipping")
        return []

    # ── Step 2: Parse the XML ────────────────────────────────────────────────
    # We pass the downloaded text (not the URL) so feedparser uses our headers
    try:
        parsed = feedparser.parse(response.text)
    except Exception as e:
        print(f"  ✗ {name}: XML parse error — {e} — skipping")
        return []

    # feedparser sets 'bozo' to True when it finds XML problems, but often
    # still extracts entries successfully. We only give up if there are no entries.
    if not parsed.entries:
        hint = f" ({parsed.bozo_exception})" if parsed.bozo else ""
        print(f"  ✗ {name}: no articles found{hint} — skipping")
        return []

    # ── Step 3: Extract articles ─────────────────────────────────────────────
    cutoff   = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    articles = []

    for entry in parsed.entries:
        link    = entry.get("link", "").strip()
        title   = strip_html(entry.get("title", "(no title)"))
        summary = best_summary(entry)
        pub     = parse_date(entry)

        # Skip very old articles (keeps our output file lean)
        if pub < cutoff:
            continue

        articles.append({
            "id":        make_id(link, title),
            "title":     title,
            "link":      link,
            "summary":   summary,
            "published": to_iso(pub),
            "source":    name,
            "category":  category,
        })

    print(f"  ✓ {name}: {len(articles)} article(s)")
    return articles


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    started = datetime.now(timezone.utc)
    print("=" * 55)
    print("  Personal News Aggregator — Feed Fetcher")
    print(f"  Started: {started.strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 55)

    # Make sure the output directory exists
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    # Generate app icons if they are missing
    ensure_icons()
    print()

    # Load the feed list (read ONLY the 'feeds' array; ignore _README etc.)
    with open(FEEDS, encoding="utf-8") as f:
        config = json.load(f)

    feeds = config.get("feeds", [])
    if not feeds:
        print("ERROR: No feeds found in feeds.json!")
        return

    print(f"Fetching {len(feeds)} feed(s) — one at a time, with a "
          f"{PAUSE_SECONDS}s pause between requests.\n")

    # ── Fetch every feed, one at a time ──────────────────────────────────────
    all_articles: list[dict] = []
    for i, feed in enumerate(feeds, start=1):
        print(f"[{i:2d}/{len(feeds)}] {feed['name']}")
        articles = fetch_one_feed(feed)
        all_articles.extend(articles)

        # Pause between requests (be polite; Reddit enforces this strictly)
        if i < len(feeds):
            time.sleep(PAUSE_SECONDS)

    print(f"\nRaw total before de-duplication : {len(all_articles):,} articles")

    # ── De-duplicate by ID (same URL = same article across multiple feeds) ───
    seen: set[str] = set()
    unique: list[dict] = []
    for article in all_articles:
        if article["id"] not in seen:
            seen.add(article["id"])
            unique.append(article)

    print(f"After de-duplication             : {len(unique):,} articles")

    # ── Sort newest-first ────────────────────────────────────────────────────
    unique.sort(key=lambda a: a["published"], reverse=True)

    # ── Keep only the most recent MAX_ITEMS ──────────────────────────────────
    trimmed = unique[:MAX_ITEMS]
    print(f"After trimming to {MAX_ITEMS} max          : {len(trimmed):,} articles")

    # ── Write the output file ────────────────────────────────────────────────
    output_data = {
        "updated":    to_iso(datetime.now(timezone.utc)),
        "item_count": len(trimmed),
        "items":      trimmed,
    }

    with open(OUTPUT, "w", encoding="utf-8") as f:
        # separators=(',', ':') produces compact JSON with no extra spaces
        json.dump(output_data, f, ensure_ascii=False, separators=(",", ":"))

    elapsed = (datetime.now(timezone.utc) - started).seconds
    print(f"\n✓ Saved {len(trimmed):,} articles → {OUTPUT.relative_to(ROOT)}")
    print(f"  Completed in {elapsed}s.")
    print("=" * 55)


if __name__ == "__main__":
    main()
