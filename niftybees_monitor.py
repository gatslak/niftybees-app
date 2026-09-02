#!/usr/bin/env python3
"""
niftybees_monitor.py
----------------------
One combined script that replaces the old niftybees_premarket.py +
niftybees_swing_monitor.py pair. Designed to run every ~5 minutes via
GitHub Actions during roughly 8:30 AM - 4:25 PM IST on weekdays:

  1. DAILY DIGEST — once per day, in an 8:40-8:59 AM IST window, pulls
     GIFT Nifty, NSE pre-open data, global cues, and India VIX into a
     weighted pre-market bias lean, then pushes it. Only fires once a
     day even though several runs fall inside that window.

  2. SWING CHECK — on every run inside actual market hours (9:15 AM -
     3:30 PM IST), checks the live NIFTYBEES price against the last
     point it alerted on, and pushes a notification whenever it swings
     0.5% / 1% / 2% in either direction, then resets its reference
     point so it can catch the next swing too.

Both write to the same monitor_state.json so there's one state file,
one script, one workflow — instead of two of everything.

STATE PERSISTENCE
  GitHub Actions runs are stateless, so the workflow commits
  monitor_state.json back to the repo after each run that changes it.

PUSH NOTIFICATIONS
  Requires NTFY_TOPIC (and optionally PAGES_URL for tap-through) set
  as env vars — same as before.
"""

import csv
import json
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

try:
    import yfinance as yf
except ImportError:
    yf = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

IST = ZoneInfo("Asia/Kolkata")
HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "monitor_state.json")
LOG_FILE = os.path.join(HERE, "premarket_log.csv")

DIGEST_WINDOW = ((8, 40), (8, 59))      # send the daily digest once inside this window
MARKET_OPEN = (9, 15)
MARKET_CLOSE = (15, 30)
SWING_TIERS = [                          # largest first; magnitude decides priority/sound tier
    (2.0, "urgent", "rotating_light,siren"),
    (1.0, "high",   "warning,bell"),
    (0.5, "default","bell"),
]

WEIGHTS = {
    "gift_nifty_gap": 3.0,
    "nse_preopen": 2.5,
    "us_markets": 1.5,
    "asia_markets": 1.0,
    "usdinr": 0.5,
    "india_vix": 0.5,
}

NSE_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def load_state():
    if not os.path.isfile(STATE_FILE):
        return {}
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def _ascii_safe(text):
    """HTTP headers must be latin-1 encodable. Em-dashes, curly quotes, the
    >= sign, emoji etc. all break the request before it is even sent — which
    silently killed every swing alert. Normalise the common offenders and
    strip anything else that still will not encode."""
    replacements = {
        "\u2014": "-",   # em dash
        "\u2013": "-",   # en dash
        "\u2265": ">=",  # greater-than-or-equal
        "\u2264": "<=",
        "\u2192": "->",  # right arrow
        "\u20b9": "Rs.", # rupee sign
        "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"',
        "\u00b7": "-",   # middle dot
    }
    for bad, good in replacements.items():
        text = text.replace(bad, good)
    # Final safety net for anything not covered above.
    return text.encode("latin-1", "replace").decode("latin-1")


def send_ntfy(title, message, priority="urgent", tags="bell", click_url=None):
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        return
    # Only headers are latin-1 constrained; the body is sent as UTF-8 and
    # can keep its original characters.
    headers = {"Title": _ascii_safe(title), "Priority": priority, "Tags": tags}
    if click_url:
        headers["Click"] = click_url
    try:
        r = requests.post(f"https://ntfy.sh/{topic}", data=message.encode("utf-8"),
                           headers=headers, timeout=10)
        r.raise_for_status()
        print(f"  Push sent to ntfy.sh — check your phone.")
    except Exception as e:
        print(f"  [warn] ntfy push failed: {e}")


def in_window(now_ist, window):
    (h1, m1), (h2, m2) = window
    start = now_ist.replace(hour=h1, minute=m1, second=0, microsecond=0)
    end = now_ist.replace(hour=h2, minute=m2, second=59, microsecond=0)
    return start <= now_ist <= end


def within_market_hours(now_ist):
    open_t = now_ist.replace(hour=MARKET_OPEN[0], minute=MARKET_OPEN[1], second=0, microsecond=0)
    close_t = now_ist.replace(hour=MARKET_CLOSE[0], minute=MARKET_CLOSE[1], second=0, microsecond=0)
    return open_t <= now_ist <= close_t


# ---------------------------------------------------------------------------
# Daily digest (pre-market bias)
# ---------------------------------------------------------------------------

def get_nse_session():
    s = requests.Session()
    s.headers.update(NSE_HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=8)
    except requests.RequestException:
        pass
    return s


def get_nse_preopen(session, key="NIFTY"):
    url = f"https://www.nseindia.com/api/market-data-pre-open?key={key}"
    try:
        r = session.get(url, timeout=8)
        r.raise_for_status()
        j = r.json()
        rows = j.get("data", [])
        index_row = next((row for row in rows if row.get("symbol") == "NIFTY 50"), None)
        return {
            "advances": j.get("advances"),
            "declines": j.get("declines"),
            "unchanged": j.get("unchanged"),
            "index_pChange": index_row.get("pChange") if index_row else None,
            "index_iep": index_row.get("iep") if index_row else None,
        }
    except Exception as e:
        print(f"  [warn] NSE pre-open fetch failed: {e}")
        return None


def get_nse_indices(session):
    url = "https://www.nseindia.com/api/allIndices"
    try:
        r = session.get(url, timeout=8)
        r.raise_for_status()
        j = r.json()
        out = {}
        for row in j.get("data", []):
            if row.get("index") == "NIFTY 50":
                out["nifty_prev_close"] = row.get("previousClose")
                out["nifty_last"] = row.get("last")
            if "VIX" in (row.get("index") or ""):
                out["india_vix"] = row.get("last")
                out["india_vix_pChange"] = row.get("percentChange")
        return out
    except Exception as e:
        print(f"  [warn] NSE indices fetch failed: {e}")
        return {}


def get_gift_nifty():
    if BeautifulSoup is None:
        return None
    url = "https://www.niftytrader.in/gift-nifty-live"
    try:
        r = requests.get(url, headers={"User-Agent": NSE_HEADERS["User-Agent"]}, timeout=8)
        r.raise_for_status()
        text = BeautifulSoup(r.text, "html.parser").get_text(" ", strip=True)
        m = re.search(r"Implied Nifty Open.{0,20}?([+\-\u2191\u2192\u2198\u2196]?\s?-?\d[\d,]*\.?\d*)", text)
        gap = None
        if m:
            raw = m.group(1).replace(",", "").strip()
            raw = re.sub(r"[^\d\.\-]", "", raw)
            if raw not in ("", "-", "."):
                gap = float(raw)
        return {"implied_gap": gap}
    except Exception as e:
        print(f"  [warn] GIFT Nifty scrape failed ({e})")
        return None


def get_global_cues():
    if yf is None:
        return {}
    tickers = {"dow": "^DJI", "nasdaq": "^IXIC", "nikkei": "^N225",
               "hangseng": "^HSI", "usdinr": "INR=X", "crude": "CL=F"}
    out = {}
    for name, sym in tickers.items():
        try:
            hist = yf.Ticker(sym).history(period="5d")
            if len(hist) >= 2:
                last, prev = hist["Close"].iloc[-1], hist["Close"].iloc[-2]
                out[name] = round((last - prev) / prev * 100, 2)
        except Exception:
            out[name] = None
    return out


def score_and_verdict(preopen, indices, gift, globals_):
    score, used, breakdown = 0.0, 0.0, []

    if gift and gift.get("implied_gap") is not None:
        gap = gift["implied_gap"]
        contrib = WEIGHTS["gift_nifty_gap"] * (1 if gap > 15 else -1 if gap < -15 else gap / 15)
        score += contrib; used += WEIGHTS["gift_nifty_gap"]
        breakdown.append(f"GIFT Nifty implied gap: {gap:+.1f} pts -> {contrib:+.2f}")

    if preopen and preopen.get("index_pChange") is not None:
        pc = preopen["index_pChange"]
        contrib = WEIGHTS["nse_preopen"] * max(-1, min(1, pc / 0.5))
        score += contrib; used += WEIGHTS["nse_preopen"]
        breakdown.append(f"NSE pre-open NIFTY 50: {pc:+.2f}% -> {contrib:+.2f}")

    if globals_.get("dow") is not None or globals_.get("nasdaq") is not None:
        vals = [v for v in [globals_.get("dow"), globals_.get("nasdaq")] if v is not None]
        us_avg = sum(vals) / len(vals)
        contrib = WEIGHTS["us_markets"] * max(-1, min(1, us_avg / 1.0))
        score += contrib; used += WEIGHTS["us_markets"]
        breakdown.append(f"US markets (Dow/Nasdaq avg): {us_avg:+.2f}% -> {contrib:+.2f}")

    asia_vals = [v for v in [globals_.get("nikkei"), globals_.get("hangseng")] if v is not None]
    if asia_vals:
        asia_avg = sum(asia_vals) / len(asia_vals)
        contrib = WEIGHTS["asia_markets"] * max(-1, min(1, asia_avg / 1.0))
        score += contrib; used += WEIGHTS["asia_markets"]
        breakdown.append(f"Asia markets (Nikkei/HSI avg): {asia_avg:+.2f}% -> {contrib:+.2f}")

    if globals_.get("usdinr") is not None:
        fx = globals_["usdinr"]
        contrib = WEIGHTS["usdinr"] * max(-1, min(1, -fx / 0.3))
        score += contrib; used += WEIGHTS["usdinr"]
        breakdown.append(f"USD/INR move: {fx:+.2f}% -> {contrib:+.2f}")

    if indices.get("india_vix_pChange") is not None:
        vix = indices["india_vix_pChange"]
        contrib = WEIGHTS["india_vix"] * max(-1, min(1, -vix / 5))
        score += contrib; used += WEIGHTS["india_vix"]
        breakdown.append(f"India VIX change: {vix:+.2f}% -> {contrib:+.2f}")

    norm_score = score / used if used else 0.0
    verdict = "BULLISH lean" if norm_score > 0.35 else "BEARISH lean" if norm_score < -0.35 else "NEUTRAL / flat lean"
    return norm_score, verdict, breakdown


def log_to_csv(row):
    file_exists = os.path.isfile(LOG_FILE)
    with open(LOG_FILE, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=row.keys())
        if not file_exists:
            w.writeheader()
        w.writerow(row)


def run_daily_digest(now, pages_url):
    print("\n-- DAILY DIGEST --")
    session = get_nse_session()
    preopen = get_nse_preopen(session)
    indices = get_nse_indices(session)
    gift = get_gift_nifty()
    globals_ = get_global_cues()

    score, verdict, breakdown = score_and_verdict(preopen, indices, gift, globals_)
    print(f"  Bias score: {score:+.2f} -> {verdict}")
    for line in breakdown:
        print(f"    {line}")

    log_to_csv({
        "datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
        "nifty_prev_close": indices.get("nifty_prev_close"),
        "nse_preopen_pChange": preopen.get("index_pChange") if preopen else None,
        "gift_nifty_gap": gift.get("implied_gap") if gift else None,
        "india_vix": indices.get("india_vix"),
        "dow_pct": globals_.get("dow"), "nasdaq_pct": globals_.get("nasdaq"),
        "nikkei_pct": globals_.get("nikkei"), "hangseng_pct": globals_.get("hangseng"),
        "usdinr_pct": globals_.get("usdinr"), "bias_score": round(score, 3), "verdict": verdict,
        "actual_open": "", "niftybees_open": "",
    })

    color_tag = "green_circle" if "BULLISH" in verdict else "red_circle" if "BEARISH" in verdict else "yellow_circle"
    lines = [f"Score {score:+.2f} - {verdict}"]
    if gift and gift.get("implied_gap") is not None:
        lines.append(f"GIFT Nifty gap: {gift['implied_gap']:+.1f} pts")
    if preopen and preopen.get("index_pChange") is not None:
        lines.append(f"NSE pre-open: {preopen['index_pChange']:+.2f}%")
    if globals_.get("dow") is not None:
        lines.append(f"Dow: {globals_['dow']:+.2f}%  Nasdaq: {globals_.get('nasdaq', 0):+.2f}%")
    if globals_.get("nikkei") is not None:
        lines.append(f"Nikkei: {globals_['nikkei']:+.2f}%  Hang Seng: {globals_.get('hangseng', 0):+.2f}%")
    if globals_.get("usdinr") is not None:
        lines.append(f"USD/INR: {globals_['usdinr']:+.2f}%")
    if indices.get("india_vix") is not None:
        lines.append(f"India VIX: {indices['india_vix']} ({indices.get('india_vix_pChange', 0):+.2f}%)")
    lines.append("Lean only, not a prediction - confirm at the 9:15 open.")
    lines.append("Tap for the full app: price, gauge, calculator.")

    send_ntfy(
        title=f"NIFTYBEES pre-market: {verdict}",
        message="\n".join(lines),
        priority="urgent",
        tags=f"{color_tag},bell",
        click_url=pages_url,
    )


# ---------------------------------------------------------------------------
# Swing check (intraday)
# ---------------------------------------------------------------------------

def get_price():
    if yf is None:
        raise RuntimeError("yfinance not installed")
    t = yf.Ticker("NIFTYBEES.NS")
    fast = t.fast_info
    price = fast.get("lastPrice") or fast.get("last_price")
    if not price:
        hist = t.history(period="1d", interval="1m")
        if hist.empty:
            raise RuntimeError("no price data returned")
        price = float(hist["Close"].iloc[-1])
    return float(price)


def classify_tier(abs_pct_move):
    for threshold, priority, tags in SWING_TIERS:
        if abs_pct_move >= threshold:
            return threshold, priority, tags
    return None


def run_swing_check(now, state, pages_url, force=False):
    print("\n-- SWING CHECK --")
    try:
        price = get_price()
    except Exception as e:
        print(f"  [warn] price fetch failed: {e}")
        if force:
            send_ntfy(
                title="NIFTYBEES manual test — price fetch failed",
                message=f"Could not fetch NIFTYBEES.NS price: {e}\nThis is a forced test push (manual run).",
                priority="default",
                tags="test_tube,warning",
                click_url=pages_url,
            )
        return state

    print(f"  Current price: ₹{price:.2f}")
    today_str = now.strftime("%Y-%m-%d")

    if state.get("swing_date") != today_str:
        state["swing_date"] = today_str
        state["reference_price"] = price
        print(f"  New trading day — baseline set at ₹{price:.2f}.")
        if force:
            send_ntfy(
                title="NIFTYBEES manual test — baseline set",
                message=(f"Reference price set at ₹{price:.2f}.\n"
                          f"This is a forced test push (manual run) — real swing alerts "
                          f"compare against this from here on today."),
                priority="default",
                tags="test_tube,bell",
                click_url=pages_url,
            )
        return state

    reference = state["reference_price"]
    pct_move = (price - reference) / reference * 100
    tier = classify_tier(abs(pct_move))

    if tier:
        threshold, priority, tier_tags = tier
        direction = "UP" if pct_move > 0 else "DOWN"
        color_tag = "green_circle" if pct_move > 0 else "red_circle"
        send_ntfy(
            title=f"NIFTYBEES swing: {direction} {abs(pct_move):.2f}% (\u2265{threshold}% tier)",
            message=(f"₹{reference:.2f} → ₹{price:.2f} ({pct_move:+.2f}%)\n"
                      f"Time: {now.strftime('%H:%M IST')}\n"
                      f"Tap for the full app: price, gauge, calculator."),
            priority=priority,
            tags=f"{color_tag},{tier_tags}",
            click_url=pages_url,
        )
        state["reference_price"] = price
        print(f"  ALERT ({priority} tier): {pct_move:+.2f}% move.")
    elif force:
        send_ntfy(
            title=f"NIFTYBEES manual test — {pct_move:+.2f}% since baseline",
            message=(f"Current: ₹{price:.2f}  (reference ₹{reference:.2f})\n"
                      f"No real swing threshold hit yet (need ±0.5%).\n"
                      f"This is a forced test push (manual run)."),
            priority="default",
            tags="test_tube,bell",
            click_url=pages_url,
        )
        print("  Forced test push sent (no real threshold crossed).")
    else:
        print(f"  Move so far: {pct_move:+.2f}% — no alert.")

    return state


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    now = datetime.now(IST)
    force = os.environ.get("FORCE_RUN", "false").strip().lower() == "true"
    weekday_ok = now.weekday() < 5
    pages_url = os.environ.get("PAGES_URL")
    print(f"NIFTYBEES monitor — {now.strftime('%d %b %Y, %H:%M:%S IST')}" +
          (" [MANUAL RUN — bypassing time checks]" if force else ""))

    if not weekday_ok and not force:
        print("  Weekend — market closed, nothing to do.")
        return

    state = load_state()
    today_str = now.strftime("%Y-%m-%d")
    did_something = False

    # A manual run always sends the digest immediately (that's the point of
    # testing on demand) but deliberately does NOT touch digest_sent_date —
    # so it can't accidentally suppress tomorrow's or today's real scheduled
    # digest.
    if force:
        run_daily_digest(now, pages_url)
        did_something = True
    elif in_window(now, DIGEST_WINDOW) and state.get("digest_sent_date") != today_str:
        run_daily_digest(now, pages_url)
        state["digest_sent_date"] = today_str
        did_something = True

    if within_market_hours(now) or force:
        state = run_swing_check(now, state, pages_url, force=force)
        did_something = True

    if not did_something:
        print("  Outside digest window and market hours — nothing to do.")

    save_state(state)


if __name__ == "__main__":
    sys.exit(main())
