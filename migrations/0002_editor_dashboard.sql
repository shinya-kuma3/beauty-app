CREATE TABLE editors (
 email TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 added_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE editor_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, actor TEXT NOT NULL,
 action TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE ai_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'enrich' CHECK(job_type IN ('enrich','review'));
CREATE TABLE article_checks (
 id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id), content_hash TEXT NOT NULL,
 revision INTEGER NOT NULL, input_text TEXT NOT NULL, body_chars INTEGER NOT NULL, reviewed_chars INTEGER NOT NULL,
 requested_by TEXT NOT NULL, created_at TEXT NOT NULL, result TEXT, model TEXT, completed_at TEXT,
 UNIQUE(article_id,content_hash)
);
CREATE TABLE article_versions (
 article_id TEXT NOT NULL REFERENCES articles(id), revision INTEGER NOT NULL,
 title TEXT NOT NULL, body_markdown TEXT NOT NULL, excerpt TEXT NOT NULL, category TEXT NOT NULL,
 tags TEXT NOT NULL, citations TEXT NOT NULL, ai_check_notes TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(article_id,revision)
);
INSERT INTO article_versions SELECT id,revision,title,body_markdown,excerpt,category,tags,citations,ai_check_notes,updated_at FROM articles;
CREATE TRIGGER article_version_insert AFTER INSERT ON articles BEGIN
 INSERT INTO article_versions VALUES(NEW.id,NEW.revision,NEW.title,NEW.body_markdown,NEW.excerpt,NEW.category,NEW.tags,NEW.citations,NEW.ai_check_notes,NEW.updated_at);
END;
CREATE TRIGGER article_version_update AFTER UPDATE OF revision ON articles WHEN NEW.revision != OLD.revision BEGIN
 INSERT INTO article_versions VALUES(NEW.id,NEW.revision,NEW.title,NEW.body_markdown,NEW.excerpt,NEW.category,NEW.tags,NEW.citations,NEW.ai_check_notes,NEW.updated_at);
END;
