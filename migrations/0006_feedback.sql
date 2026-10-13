CREATE TABLE feedback (
 id TEXT PRIMARY KEY, name TEXT, email TEXT, message TEXT NOT NULL,
 payload_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','read')),
 created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT
);
CREATE INDEX feedback_status_date ON feedback(status,created_at DESC);
