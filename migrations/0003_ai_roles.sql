ALTER TABLE article_checks ADD COLUMN provider TEXT NOT NULL DEFAULT 'legacy' CHECK(provider IN ('legacy','grok'));
ALTER TABLE article_checks ADD COLUMN state TEXT NOT NULL DEFAULT 'obsolete' CHECK(state IN ('pending','complete','obsolete'));
ALTER TABLE article_checks ADD COLUMN response_hash TEXT;
ALTER TABLE article_checks ADD COLUMN completed_revision INTEGER;
ALTER TABLE article_checks ADD COLUMN ai_check_notes TEXT;
UPDATE ai_jobs SET state='obsolete',lease_until=NULL,error_code=NULL WHERE job_type='review' AND state!='complete';
CREATE INDEX grok_pending_checks ON article_checks(provider,state,created_at);
