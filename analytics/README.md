# Aggregate website analytics

The homepage and seven project pages already import `/assets/js/visitor-map.js`.
That shared entry sends one image request per visible page load to the existing
MapMyVisitors counter (https://mapmyvisitors.com/web/1c8q7) and independently
collects private aggregate usage statistics. Both respect browser privacy signals
and the site's opt-out setting. The static Search Console map image remains the no-JavaScript fallback.

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
hashes, fingerprints, or per-visitor records. D1 has separate daily totals plus the
two country-only public map tables described below.
Country and region buckets below 3 views are combined in reports and exports.
The collector's query/body schema rejects unknown fields, arbitrary URLs and PII.
IP addresses and full user agents are handled by infrastructure but are not stored
by this application. Worker application observability is disabled. Up to 180 days
of daily aggregates are retained; a daily scheduled job removes older rows. The
public map's all-time country totals are kept.

## Public live map

The homepage footer map ("Visitors around the world") shows one dot per country,
the combined total (top left), zoom buttons and a "Recent visitors" list; hovering
or tapping a dot shows its country, visits and latest interval. A dot's size
combines three counts from periods that do not overlap:

- Google Search Console clicks by country from `assets/data/search-history.json`
  (`scripts/import-search-console.py`), up to 2026-10-04;
- MapMyVisitors page views from 2026-10-07 23:26 KST (when it was added) to
  2026-10-12 04:39 KST (when this collector replaced it), from
  `assets/data/mapmyvisitors-history.json`; and
- this collector's all-time page views per country from `country_totals`, read
  through the public, credential-free `GET /api/live`. Each view adds 1 to its
  country's total in the same batch as the daily aggregates; the 180-day cleanup
  does not touch this table (country code and count only, no dates).

The Search Console export ends on 2026-10-04 and collection started on 2026-10-12,
so the sum does not count the same visit twice. If a later Search Console import
covers dates after 2026-10-07, clicks that led to counted page views would be
counted twice; keep its end date before then or reconsider the sum.

MapMyVisitors was restored on 2026-10-19 10:51 KST and runs alongside this
collector; those later views duplicate collected ones and are not added. Its
public stats page gives exact per-location totals only for all time (KR 42, US 42,
DE 1, unknown 83 on 2026-10-29) and IPs for the latest 50 hits, so the file's
country split for the earlier window (104 page views by its daily chart) is an
estimate: all-time totals minus the latest 50 hits and about 14 earlier
post-restore hits, split in the latest-50 ratio. Its 55 views with no location
are added to the total but have no dot. MapMyVisitors files Microsoft cloud
addresses under the United States and many Korean addresses as unknown, so its
US share is likely too high and Korea's too low. The file holds no IPs.

A dot pulses a few times and keeps a ring when that country had a view within
`liveMap.recentMinutes` (60). For that and the recent-visitors list, each view
also adds 1 to its country's 10-minute UTC bucket in `live_country`; there is no
region, city, coordinate, page or environment column. `/api/live` returns the
newest 50 non-empty buckets from the last `liveMap.listHours` (24) as
`{code, time, views}` (the list shows at most 8, with the interval's end as
"N min ago"), and the daily cleanup deletes buckets older than one day (so none
is more than two days old). There is no per-visitor list: with no visitor IDs,
two views in one bucket from one country cannot be told apart.

Unlike the dashboard, the public map does not merge countries below 3 views: a
single view from one country is visible as one visit, and its 10-minute interval
is visible in the list for a day. That is disclosed on the privacy
page. The response is memoized per isolate for 30 seconds and sent with
`Cache-Control: public, max-age=30`; the homepage loads map data only when the
footer map is opened and polls every 60 seconds while it is open and visible.
If `/api/live` is unavailable, the Search Console dots are still drawn.

`assets/data/analytics-config.json` → `liveMap` sets `recentMinutes`, `listHours` and the display
weight of the home country (`homeCountry`, `homeWeight`). The weight changes dot
size only; hover tooltips show real counts. Dot positions come from
`assets/data/country-points.json` (`python scripts/build-country-points.py`).

Apply migration `0002_public_map.sql` (`npm run db:remote`) before deploying this
Worker: ingestion writes all tables in one batch and fails without the new ones.
The migration seeds `country_totals` from every daily country total collected so
far; views received between the migration and the deploy are not added to it.
`npm run preview:live-sample` starts the local preview with clearly sample rows,
because local requests carry no Cloudflare country.

## Current activation state

The deployed dashboard is https://rush-analytics.r-ush.workers.dev/ and the
collector is its `/collect` endpoint, configured in
`assets/data/analytics-config.json`. Publishing this configuration through the
GitHub Pages workflow activates collection on the homepage and project pages.
MapMyVisitors uses the original site ID and works independently of this endpoint.
An empty `endpoint` disables only the private aggregate collector.

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
