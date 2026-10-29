-- Public homepage map. Country codes and counts only: no region, city, coordinates,
-- page, IP address, user agent or visitor identifier.

-- All-time page views per country. Not removed by the 180-day cleanup.
CREATE TABLE IF NOT EXISTS country_totals (
  country TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0)
) WITHOUT ROWID;

-- Recent-visit markers: views per country in 10-minute UTC buckets, deleted after
-- one day by the daily cleanup (so at most two days old).
CREATE TABLE IF NOT EXISTS live_country (
  bucket INTEGER NOT NULL,
  country TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0),
  PRIMARY KEY (bucket, country)
) WITHOUT ROWID;

-- Start the all-time totals from every daily country total collected so far.
INSERT OR IGNORE INTO country_totals (country, views)
SELECT label, CAST(SUM(value) AS INTEGER)
FROM daily_metrics
WHERE dimension = 'country' AND metric = 'views' AND label <> 'Unknown'
GROUP BY label;
