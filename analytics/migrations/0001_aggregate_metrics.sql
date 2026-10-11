-- No event log, visitor/session identifier, IP address, URL or user-agent column.
-- Dimensions are separate totals; there is no country x page x device history.
CREATE TABLE IF NOT EXISTS daily_metrics (
  day TEXT NOT NULL,
  dimension TEXT NOT NULL,
  label TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0 CHECK(value >= 0),
  PRIMARY KEY (day, dimension, label, metric)
) WITHOUT ROWID;
