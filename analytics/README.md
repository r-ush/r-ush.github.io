# Aggregate website analytics

The homepage and seven project pages already import `/assets/js/visitor-map.js`.
That shared entry now collects aggregate usage statistics instead of contacting
MapMyVisitors. Existing Search Console map artwork remains a historical view.

## What is implemented

- Daily/page/hourly view counts in Asia/Seoul time; 1/7/30/90/180-day reports.
- Independent country/administrative-region, referral-category, device, browser,
  and operating-system distributions. Region codes, never cities or coordinates.
- Link, CV/download, outbound and email clicks; section opens; deliberate video
  starts/completions (excluding looped hover previews and autoplay).
- Scroll milestones at 25/50/75/100 percent of the currently expanded document.
- Visible, focused active seconds, with a 60-second inactivity cutoff; average
  active seconds per page view and the share of views reaching 10 active seconds.
- Average page-load and first-response timing with explicit sample counts.
- A private-data dashboard, aggregate CSV/JSON export, empty/error states, and a
  clearly marked sample-data mode that never writes to the database.
- A footer privacy/settings link; GPC and DNT handling; browser opt-out; no banner.

There are no unique visitors, return rates, sessions, cross-page funnels, identity
hashes, fingerprints, or per-visitor records. D1 has only separate daily totals.
Country and region buckets below 3 views are combined in reports and exports.
The collector's query/body schema rejects unknown fields, arbitrary URLs and PII.
IP addresses and full user agents are handled by infrastructure but are not stored
by this application. Worker application observability is disabled. Up to 180 days
of aggregates are retained; a daily scheduled job removes older rows.

## Current activation state

The deployed dashboard is https://rush-analytics.r-ush.workers.dev/ and the
collector is its `/collect` endpoint, configured in
`assets/data/analytics-config.json`. Publishing this configuration through the
GitHub Pages workflow activates collection on the homepage and project pages.
The old MapMyVisitors calls are removed. An empty `endpoint` disables collection.

Dashboard data requires the administrator key; the login shell and sample-data
mode are public. Version preview URLs are disabled. The Cloudflare dashboard
manages the Worker and database; use the deployed URL above to read site statistics.

## Administrator key on this Windows PC

If the deployment saved a key for this Windows user, it is encrypted with Windows
DPAPI in `%LOCALAPPDATA%\rush-analytics\admin-token.clixml`, outside this repository.
From the repository root, copy it to the clipboard without printing it:

```powershell
powershell -NoProfile -File .\analytics\scripts\copy-admin-key.ps1
```

Paste it into the dashboard's administrator-key field. Keep a separate copy in
your password manager: the encrypted file can only be opened by this Windows
account and is not a portable backup. Never use the local preview's test key for
the deployed dashboard.

## Local validation and preview

Requires Node.js 24 or newer. Run from this `analytics` directory:

```sh
npm ci
npm test
npm run preview
```

Open `http://127.0.0.1:8787/` to generate local test traffic and
`http://127.0.0.1:8787/admin/` to view it. The preview starts an empty, temporary
in-memory SQLite database, uses the real Worker handlers, and modifies the tracker
configuration only in local HTTP responses. Production files are not activated.
Use the explicitly local test key printed by the preview server. Never reuse it
in production. The dashboard's sample button is another way to inspect charts.

Tests cover sanitization, IP/ID exclusion, authentication, SQL aggregation, bot and
privacy-signal filtering, KST date boundaries, retention, hidden/idle time,
cross-tab opt-out, scroll deduplication and semantic link classification.

For a Cloudflare-runtime smoke test, apply local migrations and run Wrangler:

```sh
npm run db:local
npx wrangler dev --local
npx wrangler deploy --dry-run
```

## Deploy to your Cloudflare account

1. Run `npx wrangler login` and complete the browser sign-in yourself.
2. Run `npx wrangler d1 create rush-analytics`. Replace the all-zero
   `database_id` in `wrangler.jsonc` with the returned database ID. The ID is not
   a secret. Keep `ALLOW_LOCALHOST` out of production configuration.
3. Run `npm run db:remote` to create the aggregate table.
4. Create a strong random administrator key (at least 32 random bytes, represented
   as hex or base64, using a password manager). Save it in your password manager.
   Run `npx wrangler secret put ADMIN_TOKEN` and enter the key at its hidden prompt.
   Do not put the key in source code, URLs, GitHub Pages files or chat messages.
5. Run `npm run deploy`. Open the returned Worker URL to access the dashboard.
   The dashboard HTML is public, but every statistics request requires the key.
   The key is held only in tab memory and is discarded on reload/logout.
6. Point the shared script at the Worker using its real URL:

   ```sh
   node scripts/set-endpoint.mjs https://YOUR-WORKER.workers.dev/collect
   ```

7. Commit and publish the homepage repository through its existing GitHub Pages
   workflow. This updates the shared script for all project pages; their separate
   repositories do not need edits. Do not rename `visitor-map.js` without updating
   those existing script references.
8. Open `https://r-ush.github.io/privacy.html` and exclude your own browser if
   desired. This sets only the local preference `rush-analytics-disabled=1`.
   No visitor identifier or analytics cookie is created. Clearing site data resets
   this preference. Restore collection there and reload a public page to test.

Use a separate admin key for local Wrangler development in ignored `.dev.vars`.
Never publish `.dev.vars`, `.wrangler`, `node_modules`, or the preview database.
The whole `analytics/` directory is excluded from the Jekyll Pages build.

## Measurement limits and operational choices

- These are page views, not people. Reloads count. A document restored from the
  back/forward cache retains its in-memory page counters and does not add a view.
- DNT/GPC, opt-out, blockers, missing referrers, JavaScript disabled, network loss
  and known-bot filtering can reduce counts. Unknown bots and forged requests can
  still inflate public collection; Origin validation is not authentication.
- Requests are not retried: without event identifiers, automatic retries could
  double-count events already committed by the server.
- The tracker sends short batches with `credentials: omit` and no Referer header.
  It never transmits current URL queries/fragments, raw referrer URLs, link text,
  email addresses, video URLs, or unknown page paths. External sources and link
  destinations are mapped to a fixed list of categories before transmission.
- Five-second local activity sampling caps each increment, pauses hidden/unfocused
  tabs, and stops idle time after 60 seconds. This is an estimate, not attention
  detection. Cross-midnight measurements fall on their receiving KST date.
- Download counts are clicks, not successful file downloads. Embedded third-party
  players do not expose local video events, so they are not instrumented.
- Globally keyed rate limits reduce ingestion abuse without using per-IP or
  per-person keys. Cloudflare applies these per location, not as an exact global
  billing cap. Ingest is limited to 600 requests/minute/location. Namespace IDs
  1001/1002 must not collide with other rate-limit namespaces in your account.
- A failed database request returns a generic error and does not expose/log input.
  Never add raw HTTP request logging or third-party analytics to this collector.
- The main privacy page describes application behavior separately from hosting
  providers' independent security/operational processing.

This is a no-banner implementation, not a blanket assertion of legal exemption in
every jurisdiction. Statistical-purpose exceptions have scope and configuration
conditions, and some require clear information plus an easy opt-out. Keep these
controls and reassess applicability before adding data types or activating where
the relevant exception does not apply. Do not replace the missing visitor ID with
IP/UA hashing or browser fingerprinting.

References: [ICO statistical-purpose exception](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/),
[CNIL audience measurement](https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies-solutions-pour-les-outils-de-mesure-daudience),
[Cloudflare D1](https://developers.cloudflare.com/d1/),
[Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
