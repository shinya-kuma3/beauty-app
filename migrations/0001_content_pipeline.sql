PRAGMA foreign_keys = ON;
CREATE TABLE sources (
 id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('x','research','youtube')),
 source_url TEXT NOT NULL UNIQUE, author TEXT NOT NULL, title TEXT NOT NULL,
 raw_summary TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'ja', fetched_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','used','rejected')),
 video_id TEXT UNIQUE, video_seconds INTEGER, content_hash TEXT NOT NULL,
 tags TEXT NOT NULL DEFAULT '[]', summary TEXT, key_points TEXT,
 embedding_model TEXT, summary_model TEXT, processed_at TEXT, ai_status TEXT NOT NULL DEFAULT 'queued'
);
CREATE INDEX sources_status ON sources(status,fetched_at);
CREATE TABLE articles (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, body_markdown TEXT NOT NULL,
 excerpt TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('skin','hair','nail','body')),
 tags TEXT NOT NULL DEFAULT '[]', citations TEXT NOT NULL, ai_check_notes TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_review','published','rejected')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT, reviewed_by TEXT,
 content_hash TEXT NOT NULL, summary TEXT, key_points TEXT, ai_tags TEXT NOT NULL DEFAULT '[]',
 embedding_model TEXT, summary_model TEXT, processed_at TEXT, ai_status TEXT NOT NULL DEFAULT 'queued',
 metadata_edited INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, mutation_token TEXT,
 CHECK(status != 'published' OR (published_at IS NOT NULL AND reviewed_by IS NOT NULL AND ai_status='complete'))
);
CREATE INDEX articles_status ON articles(status,created_at);
CREATE TABLE article_sources (
 article_id TEXT NOT NULL REFERENCES articles(id), source_id TEXT NOT NULL REFERENCES sources(id),
 PRIMARY KEY(article_id,source_id)
);
CREATE TABLE review_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL REFERENCES articles(id),
 actor TEXT NOT NULL, action TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER article_initial_status BEFORE INSERT ON articles WHEN NEW.status != 'draft'
 BEGIN SELECT RAISE(ABORT,'Articles must start as drafts'); END;
CREATE TRIGGER article_status_transition BEFORE UPDATE OF status ON articles
 WHEN OLD.status != NEW.status AND NOT ((OLD.status='draft' AND NEW.status='pending_review') OR
 (OLD.status='pending_review' AND NEW.status IN ('published','rejected')))
 BEGIN SELECT RAISE(ABORT,'Invalid article state transition'); END;
CREATE TRIGGER article_terminal_immutable BEFORE UPDATE ON articles WHEN OLD.status IN ('published','rejected')
 BEGIN SELECT RAISE(ABORT,'Reviewed articles are immutable'); END;
CREATE TABLE channels (
 id TEXT PRIMARY KEY, handle TEXT UNIQUE, channel_id TEXT UNIQUE, title TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'candidate' CHECK(state IN ('candidate','approved','rejected')),
 uploads_playlist TEXT, last_checked_at TEXT, last_video_published_at TEXT
);
INSERT INTO channels(id,handle,title,enabled,state) VALUES('ega-test','@EGA.channel','EGA.channel（テスト）',1,'approved');
CREATE TABLE ai_jobs (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('source','article')),
 entity_id TEXT NOT NULL, content_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, lease_until TEXT,
 error_code TEXT, created_at TEXT NOT NULL, UNIQUE(entity_type,entity_id,content_hash)
);
CREATE INDEX jobs_ready ON ai_jobs(state,next_attempt_at,lease_until);
CREATE TABLE ai_cache (
 cache_key TEXT PRIMARY KEY, kind TEXT NOT NULL, model TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE ai_cache_locks (cache_key TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_until TEXT NOT NULL);
CREATE TABLE tag_vectors (
 tag_id TEXT PRIMARY KEY, description_hash TEXT NOT NULL, model TEXT NOT NULL, vector TEXT NOT NULL
);
CREATE TABLE embeddings (
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL,
 vector TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(entity_type,entity_id,content_hash,model)
);
CREATE TABLE daily_budget (
 day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, tokens_reserved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ai_usage (
 id TEXT PRIMARY KEY, day TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
 input_tokens INTEGER, output_tokens INTEGER, reserved_tokens INTEGER NOT NULL,
 usage_estimated INTEGER NOT NULL DEFAULT 1, outcome TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX usage_day ON ai_usage(day);
CREATE TABLE rate_limits (bucket TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE publication_jobs (
 id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id), state TEXT NOT NULL DEFAULT 'queued',
 build_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
