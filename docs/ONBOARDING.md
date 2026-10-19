# Onboarding a new client

For people who got an account on a hosted HanuAnalytics (for example analytics.carebun.com), and for the admin who
approves them. Self-hosters: start with the README, then come back here from step 3.

## For the admin: approving a request

1. Requests arrive from the home page's form and show under **Requests** in the sidebar (instance admin only),
   with a badge for new ones.
2. **Approve** creates an organization for them and an invite link that makes them its owner. Nothing is emailed
   automatically: copy the link (or use the mail button, which opens your mail app with a short welcome) and send it.
3. **Reject** closes the request. Both decisions are kept, with the date.
4. If you would rather let anyone sign up, switch **Sign-up** to *open* on the System page; `/register` then works
   without an invite. The hosted beta runs invite-only.

## For the client: from invite to first event

1. **Open the invite link.** Create your password (an existing account with the same email just joins). You land
   in your organization.
2. **Create a project** for each site or app. Give it the domains it will run on, including `localhost` if you
   want to test from a dev server, and its timezone. Wildcards work: `*.example.com`.
3. **Install the snippet** from Settings → Snippet & keys:
   ```html
   <script async src="https://analytics.carebun.com/hanu.js" data-token="ha_pk_…"></script>
   ```
   Put it in the `<head>` of every page (a layout file, a tag manager, or the framework's instrumentation file).
   Nothing else is required: pageviews, single-page-app navigations, clicks, outbound links, downloads, forms,
   errors, Web Vitals and session recordings are captured automatically.
4. **Watch Live.** Open your site in a browser; the Live page shows the visit within seconds. If nothing arrives,
   the browser's network tab tells you why: `403` means the page's domain is not in the project's list, `401`
   means the key is wrong.
5. **Name your events.** `hanu.capture("signup", {plan: "pro"})` for the moments that matter;
   `hanu.identify("user-42", {email: "…"})` when someone signs in; `hanu.reset()` when they sign out. The full
   API, the npm/ESM build and the privacy options are in [SDK.md](SDK.md).
6. **Tune recording** in Settings → Recording: on or off, sample rate, extra masking selectors, blocked elements.
   Inputs are always masked before leaving the visitor's browser.
7. **Set retention** in Settings → Retention: how long to keep events (default a year) and recordings (default
   30 days).
8. **Invite your team** from Team: owners, admins and members. Members see dashboards; admins change settings.

## What you get

Dashboard (visitors, pageviews, sessions, bounce rate, duration, trend, compare to the previous period), Pages,
Sources and campaigns, Locations down to city, Devices, Events with property breakdowns, Funnels, Retention,
Errors, Web Vitals, Live, Sessions with replay, Persons, and read-only SQL over your raw events with CSV export.

## Limits during the free beta

Fair use: sites up to a few million events a month and recordings at the sample rate you choose. If your traffic
is well beyond that, say so in the request and we will plan for it. Paid plans will be announced before they
apply; self-hosting from the public repository stays free.

## Your data

Your organization's events live in the host's bucket under your project ids; no raw IP addresses are stored
(see [PRIVACY.md](PRIVACY.md)). You can export at any time: SQL → CSV in the dashboard, or ask the admin for the
Parquet files of your project. Deleting a project deletes its events, recordings, sessions and persons.
