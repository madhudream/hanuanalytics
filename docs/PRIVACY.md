# Privacy

HanuAnalytics is built to be a Google Analytics replacement you can defend.

* **No raw IP addresses are stored.** The IP is used once, in memory, to look up country / region / city and to
  compute a visitor hash; the hash salt is a secret of your instance and the hash changes every day.
* **Visitor identity.** By default the SDK keeps a random `anon_id` in `localStorage` (a cookie fallback on old
  browsers). In **cookieless mode** (a project setting) the SDK stores nothing between page loads and the server
  counts visitors with the daily hash of (salt, day, project, IP, user agent) — the Plausible / Fathom approach,
  with no consent banner needed in most readings of ePrivacy.
* **`hanu.identify()` is yours to call.** Nothing is identified unless your site does it.
* **Session recording masks every input by default** (`mask_all_inputs`), and you can add a `mask_text_selector`
  and a `block_selector` per project. Masking happens in the visitor's browser; masked text never leaves it.
  Password fields are always masked; e-mail addresses, card numbers and similar patterns in captured click text
  are masked by the SDK too.
* **Do Not Track** can be honoured per project (`respect_dnt`); `hanu.optOut()` stores an opt-out in the browser.
* **Bots** (known crawlers, headless browsers, `navigator.webdriver`) send nothing and are excluded from stats.
* **Retention** is per project: events (default 365 days) and recordings (default 30 days) are deleted by the
  daily job; the bucket's lifecycle rule deletes any recording object older than 90 days regardless.
* **Domains.** A project's token only works from its listed domains (Origin / Referer check), so a leaked public
  key cannot be used to pollute your data from elsewhere.
* **Where the data lives.** In your bucket, in your project, in the region you chose. Nothing is sent anywhere
  else; the only outbound call the server makes is the monthly GeoIP download from db-ip.com (or none, if you
  upload it yourself).
