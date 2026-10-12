CREATE TABLE content_releases (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, main_base_sha TEXT NOT NULL, develop_sha TEXT NOT NULL,
 payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','superseded','released')),
 result TEXT, response_hash TEXT, main_sha TEXT, build_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX releases_pending ON content_releases(state,created_at);
ALTER TABLE publication_jobs ADD COLUMN release_id TEXT;
ALTER TABLE publication_jobs ADD COLUMN snapshot_hash TEXT;

DROP TRIGGER article_status_transition;
DROP TRIGGER article_terminal_immutable;
CREATE TRIGGER article_status_transition BEFORE UPDATE OF status ON articles
 WHEN OLD.status!=NEW.status AND NOT ((OLD.status='draft' AND NEW.status='pending_review') OR (OLD.status='pending_review' AND NEW.status IN ('published','rejected')) OR (OLD.status='published' AND NEW.status='draft' AND NEW.revision=OLD.revision+1 AND NEW.published_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.mutation_token IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'Invalid article state transition'); END;
CREATE TRIGGER article_terminal_immutable BEFORE UPDATE ON articles
 WHEN OLD.status='rejected' OR (OLD.status='published' AND NOT (NEW.status='draft' AND NEW.revision=OLD.revision+1 AND NEW.published_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.mutation_token IS NOT NULL AND NEW.title=OLD.title AND NEW.body_markdown=OLD.body_markdown AND NEW.excerpt=OLD.excerpt AND NEW.category=OLD.category AND NEW.tags=OLD.tags AND NEW.citations=OLD.citations AND NEW.ai_check_notes=OLD.ai_check_notes AND NEW.content_hash=OLD.content_hash))
 BEGIN SELECT RAISE(ABORT,'Reviewed articles are immutable; create a revision'); END;
