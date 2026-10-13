-- Private aggregates only; raw CSV, emails and credentials are never stored here.
CREATE TABLE billing_snapshots (
  provider TEXT PRIMARY KEY,
  payload TEXT,
  fetched_at TEXT,
  attempted_at TEXT NOT NULL,
  error_code TEXT
);
CREATE TABLE api_usage (
  day TEXT NOT NULL,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day,service,operation)
);
CREATE INDEX ai_usage_month_provider ON ai_usage(day,provider,model);
