CREATE TABLE article_withdrawals (
 id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,article_id TEXT,revision_token TEXT NOT NULL,
 reason TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','building','withdrawn')),
 main_sha TEXT,build_id TEXT,updated_at TEXT NOT NULL
);
CREATE INDEX article_withdrawals_state ON article_withdrawals(state,created_at);
CREATE TRIGGER withdrawals_preserve BEFORE DELETE ON article_withdrawals BEGIN SELECT RAISE(ABORT,'Withdrawal history must be preserved'); END;
CREATE TRIGGER withdrawals_identity BEFORE UPDATE ON article_withdrawals WHEN NEW.id!=OLD.id OR NEW.slug!=OLD.slug OR NEW.actor!=OLD.actor OR NEW.reason!=OLD.reason OR NEW.revision_token!=OLD.revision_token BEGIN SELECT RAISE(ABORT,'Withdrawal approval is immutable'); END;
