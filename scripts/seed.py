#!/usr/bin/env python3
"""Seed a project with realistic-looking traffic (for demos and local testing).
   scripts/seed.py <public_key> [api_base=http://127.0.0.1:8090] [visitors=40] [origin=https://example.com]"""
import gzip, json, random, sys, time, urllib.request

key = sys.argv[1]
base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8090"
nvis = int(sys.argv[3]) if len(sys.argv) > 3 else 40
origin = sys.argv[4] if len(sys.argv) > 4 else "https://example.com"
now = int(time.time() * 1000)
random.seed(int(time.time()))
UAS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
]
REFS = ["https://www.google.com/", "", "", "https://t.co/abc", "https://news.ycombinator.com/item?id=1", "https://www.linkedin.com/feed/", "https://chatgpt.com/"]
PATHS = ["/", "/", "/pricing", "/blog/hello-world", "/blog/why-hanu", "/docs", "/docs/sdk", "/signup", "/about"]
IPS = ["49.207.1.1", "103.21.244.5", "8.8.8.8", "81.2.69.142", "203.0.113.9", "13.235.1.1", "45.112.1.1", "202.88.1.1"]
total = 0
for v in range(nvis):
    anon = f"a_{random.randrange(10**9):09d}"
    ua = random.choice(UAS)
    ip = random.choice(IPS)
    for s in range(random.choice([1, 1, 1, 2, 3])):
        sid = f"s_{random.randrange(10**9):09d}"
        t = now - random.randint(0, 29 * 86400000)
        ref = random.choice(REFS)
        url = origin + random.choice(PATHS) + ("?utm_source=newsletter&utm_medium=email&utm_campaign=launch" if random.random() < 0.15 else "")
        bp = {"$screen_width": random.choice([1440, 1920, 390, 412]), "$screen_height": 900, "$viewport_width": 1200, "$viewport_height": 800, "$language": random.choice(["en-IN", "en-US", "hi-IN"]), "$timezone": "Asia/Kolkata"}
        ev = [{"event": "$pageview", "ts": t, "distinct_id": anon, "anon_id": anon, "session_id": sid, "props": {**bp, "$current_url": url, "$title": "Home", "$referrer": ref, "$is_new_visitor": s == 0, "$session_start": True}}]
        for _ in range(random.choice([0, 0, 1, 2, 3, 5])):
            t += random.randint(5000, 180000)
            ev.append({"event": "$pageleave", "ts": t, "distinct_id": anon, "anon_id": anon, "session_id": sid, "props": {**bp, "$current_url": url, "$duration_ms": random.randint(3000, 90000), "$scroll_depth": random.randint(10, 100)}})
            url = origin + random.choice(PATHS)
            ev.append({"event": "$pageview", "ts": t + 10, "distinct_id": anon, "anon_id": anon, "session_id": sid, "props": {**bp, "$current_url": url, "$title": "Page"}})
            if random.random() < 0.4:
                ev.append({"event": "$autocapture", "ts": t + 500, "distinct_id": anon, "anon_id": anon, "session_id": sid, "props": {**bp, "$current_url": url, "$el_tag": "button", "$el_text": random.choice(["Get started", "Sign up", "Read more"])}})
        if random.random() < 0.2:
            did = f"user{v}@example.com"
            ev.append({"event": "signup", "ts": t + 1000, "distinct_id": did, "anon_id": anon, "session_id": sid, "props": {**bp, "$current_url": url, "plan": random.choice(["free", "free", "pro"])}, "set": {"email": did, "plan": "pro"}})
            if random.random() < 0.5:
                ev.append({"event": "purchase", "ts": t + 5000, "distinct_id": did, "anon_id": anon, "session_id": sid, "props": {**bp, "$current_url": url, "amount": random.choice([9, 29, 99])}})
        if random.random() < 0.1:
            ev.append({"event": "$exception", "ts": t + 2000, "distinct_id": anon, "anon_id": anon, "session_id": sid, "props": {**bp, "$current_url": url, "$message": random.choice(["TypeError: x is undefined", "ReferenceError: foo is not defined"]), "$source": "app.js", "$stack": "at foo (app.js:1:1)"}})
        ev.append({"event": "$web_vitals", "ts": t + 3000, "distinct_id": anon, "anon_id": anon, "session_id": sid, "props": {**bp, "$current_url": url, "$lcp": random.randint(900, 4500), "$cls": round(random.random() * 0.3, 3), "$inp": random.randint(50, 600), "$fcp": random.randint(800, 2500), "$ttfb": random.randint(100, 900)}})
        body = json.dumps({"token": key, "sent_at": now, "lib": "hanu-js", "lib_version": "0.1.0", "events": ev}).encode()
        req = urllib.request.Request(base + "/api/v1/e", data=gzip.compress(body), method="POST")
        for h, val in [("Content-Type", "text/plain"), ("Content-Encoding", "gzip"), ("Origin", origin), ("User-Agent", ua), ("X-Forwarded-For", ip)]:
            req.add_header(h, val)
        r = urllib.request.urlopen(req).read().decode()
        total += len(ev)
print(f"sent {total} events for {nvis} visitors; last response {r}")
