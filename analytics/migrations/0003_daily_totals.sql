-- Site-wide page views per Asia/Seoul day, kept beyond daily_metrics' 180-day
-- retention for the cumulative visits chart (date and count only).
CREATE TABLE IF NOT EXISTS daily_totals (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0)
) WITHOUT ROWID;

INSERT OR IGNORE INTO daily_totals (day, views)
SELECT day, CAST(SUM(value) AS INTEGER) FROM daily_metrics
WHERE dimension = 'total' AND label = 'all' AND metric = 'views'
GROUP BY day;
