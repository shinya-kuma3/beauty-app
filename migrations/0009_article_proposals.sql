ALTER TABLE articles ADD COLUMN original_slug TEXT CHECK(original_slug IS NULL OR original_slug=slug);
CREATE UNIQUE INDEX article_original_slug ON articles(original_slug) WHERE original_slug IS NOT NULL;
CREATE TRIGGER article_origin_immutable BEFORE UPDATE OF original_slug ON articles WHEN OLD.original_slug IS NOT NEW.original_slug
 BEGIN SELECT RAISE(ABORT,'Article origin is immutable'); END;
ALTER TABLE article_checks ADD COLUMN proposal_decision TEXT CHECK(proposal_decision IN ('accepted','declined'));
ALTER TABLE article_checks ADD COLUMN decided_by TEXT;
ALTER TABLE article_checks ADD COLUMN decided_at TEXT;
ALTER TABLE articles ADD COLUMN display_updated_at TEXT;
