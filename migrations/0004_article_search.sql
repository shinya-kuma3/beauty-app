CREATE VIRTUAL TABLE article_search USING fts5(title,excerpt,body_markdown,tags,ai_check_notes,content='articles',content_rowid='rowid',tokenize='trigram',detail='none');
INSERT INTO article_search(article_search) VALUES('rebuild');
CREATE TRIGGER article_search_insert AFTER INSERT ON articles BEGIN
 INSERT INTO article_search(rowid,title,excerpt,body_markdown,tags,ai_check_notes) VALUES(NEW.rowid,NEW.title,NEW.excerpt,NEW.body_markdown,NEW.tags,NEW.ai_check_notes);
END;
CREATE TRIGGER article_search_update AFTER UPDATE OF title,excerpt,body_markdown,tags,ai_check_notes ON articles BEGIN
 INSERT INTO article_search(article_search,rowid,title,excerpt,body_markdown,tags,ai_check_notes) VALUES('delete',OLD.rowid,OLD.title,OLD.excerpt,OLD.body_markdown,OLD.tags,OLD.ai_check_notes);
 INSERT INTO article_search(rowid,title,excerpt,body_markdown,tags,ai_check_notes) VALUES(NEW.rowid,NEW.title,NEW.excerpt,NEW.body_markdown,NEW.tags,NEW.ai_check_notes);
END;
CREATE TRIGGER article_search_delete AFTER DELETE ON articles BEGIN
 INSERT INTO article_search(article_search,rowid,title,excerpt,body_markdown,tags,ai_check_notes) VALUES('delete',OLD.rowid,OLD.title,OLD.excerpt,OLD.body_markdown,OLD.tags,OLD.ai_check_notes);
END;
CREATE TABLE article_tags(article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,tag TEXT COLLATE NOCASE NOT NULL,PRIMARY KEY(article_id,tag));
CREATE INDEX article_tags_lookup ON article_tags(tag,article_id);
INSERT OR IGNORE INTO article_tags SELECT a.id,trim(j.value) FROM articles a,json_each(a.tags) j WHERE j.type='text' AND trim(j.value)!='';
CREATE TRIGGER article_tags_insert AFTER INSERT ON articles BEGIN
 INSERT OR IGNORE INTO article_tags SELECT NEW.id,trim(value) FROM json_each(NEW.tags) WHERE type='text' AND trim(value)!='';
END;
CREATE TRIGGER article_tags_update AFTER UPDATE OF tags ON articles BEGIN
 DELETE FROM article_tags WHERE article_id=NEW.id;
 INSERT OR IGNORE INTO article_tags SELECT NEW.id,trim(value) FROM json_each(NEW.tags) WHERE type='text' AND trim(value)!='';
END;
CREATE INDEX articles_created_sort ON articles(status,created_at,id);
CREATE INDEX articles_updated_sort ON articles(status,updated_at,id);
CREATE INDEX articles_published_sort ON articles(status,published_at,id);
CREATE INDEX articles_category_created ON articles(category,created_at,id);
