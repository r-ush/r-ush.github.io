-- Separate, private records for the unlisted portfolio only.
CREATE TABLE IF NOT EXISTS portfolio_visits (
  visit TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  path TEXT NOT NULL,
  ip TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  city TEXT NOT NULL,
  browser TEXT NOT NULL,
  device TEXT NOT NULL,
  os TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS portfolio_visits_first_seen ON portfolio_visits(first_seen);
CREATE TABLE IF NOT EXISTS portfolio_activity (
  visit TEXT NOT NULL REFERENCES portfolio_visits(visit) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visit, kind, target)
);
