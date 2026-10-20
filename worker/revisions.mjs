import { ApiError, now, contentHash, hash, parse } from "./core.mjs";
import { originalArticles } from "./original-articles.mjs";
import { z } from "zod";
export async function reviseArticle(env, id, revision, actor) {
  const time = now(),
    token = crypto.randomUUID();
  const row = await env.DB.prepare(
    "SELECT content_hash FROM articles WHERE id=? AND revision=? AND status='published'",
  )
    .bind(id, revision)
    .first();
  if (!row) throw new ApiError(409, "revision_conflict");
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE articles SET status='draft',revision=revision+1,published_at=NULL,reviewed_by=NULL,updated_at=?,ai_status='queued',mutation_token=? WHERE id=? AND revision=? AND status='published'",
    ).bind(time, token, id, revision),
    env.DB.prepare(
      "UPDATE articles SET status='pending_review' WHERE id=? AND mutation_token=? AND status='draft'",
    ).bind(id, token),
    env.DB.prepare(
      "INSERT INTO review_events(article_id,actor,action,revision,created_at) SELECT id,?,'revision_started',revision,? FROM articles WHERE id=? AND mutation_token=?",
    ).bind(actor, time, id, token),
    env.DB.prepare(
      "INSERT OR IGNORE INTO ai_jobs(id,entity_type,entity_id,content_hash,next_attempt_at,created_at) SELECT ?,'article',id,content_hash,?,? FROM articles WHERE id=? AND mutation_token=?",
    ).bind(crypto.randomUUID(), time, time, id, token),
    env.DB.prepare(
      "UPDATE ai_jobs SET state='queued',attempts=0,next_attempt_at=?,lease_until=NULL,error_code=NULL WHERE entity_type='article' AND entity_id=? AND content_hash=? AND EXISTS(SELECT 1 FROM articles WHERE id=? AND mutation_token=?)",
    ).bind(time, id, row.content_hash, id, token),
  ]);
  if (!result[0].meta.changes) throw new ApiError(409, "revision_conflict");
  return {
    id,
    status: "pending_review",
    revision: revision + 1,
  };
}
const editPublicationSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    revision_token: z.string().max(100),
  })
  .strict();
export async function editPublication(env, input, actor) {
  const data = parse(editPublicationSchema, input);
  if (
    await env.DB.prepare("SELECT id FROM article_withdrawals WHERE slug=?")
      .bind(data.slug)
      .first()
  )
    throw new ApiError(409, "article_withdrawn");
  const existing = await env.DB.prepare("SELECT * FROM articles WHERE slug=?")
    .bind(data.slug)
    .first();
  if (existing) {
    if (data.revision_token !== "db:" + existing.revision)
      throw new ApiError(409, "revision_conflict");
    if (existing.status === "pending_review")
      return {
        id: existing.id,
        status: existing.status,
        revision: existing.revision,
      };
    return reviseArticle(env, existing.id, existing.revision, actor);
  }
  const initial = originalArticles.find(
    (row) => row.slug === data.slug && row.data.status === "published",
  );
  if (!initial) throw new ApiError(404, "publication_not_found");
  if (
    data.revision_token !==
    "static:" + (await hash(JSON.stringify(initial.data)))
  )
    throw new ApiError(409, "revision_conflict");
  const original = initial.data,
    id = crypto.randomUUID(),
    time = now();
  const article = {
    title: original.title,
    body_markdown: original.sections
      .map((section) => "## " + section.heading + "\n\n" + section.body)
      .join("\n\n"),
    excerpt: original.summary,
    category: original.category,
    tags: original.tags.slice(0, 5),
    citations: original.sources.map((source) => source.url),
    ai_check_notes:
      "初期記事の改訂版です。公開中の本文は再公開まで保持します。",
  };
  const checksum = await contentHash(article);
  const out = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO articles(id,slug,original_slug,title,body_markdown,excerpt,category,tags,citations,ai_check_notes,created_at,updated_at,content_hash,metadata_edited) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
    ).bind(
      id,
      data.slug,
      data.slug,
      article.title,
      article.body_markdown,
      article.excerpt,
      article.category,
      JSON.stringify(article.tags),
      JSON.stringify(article.citations),
      article.ai_check_notes,
      time,
      time,
      checksum,
    ),
    env.DB.prepare(
      "UPDATE articles SET status='pending_review' WHERE id=? AND status='draft'",
    ).bind(id),
    env.DB.prepare(
      "INSERT INTO review_events(article_id,actor,action,revision,created_at) SELECT id,?,'initial_revision_started',revision,? FROM articles WHERE id=?",
    ).bind(actor, time, id),
    env.DB.prepare(
      "INSERT OR IGNORE INTO ai_jobs(id,entity_type,entity_id,content_hash,next_attempt_at,created_at) SELECT ?,'article',id,content_hash,?,? FROM articles WHERE id=?",
    ).bind(crypto.randomUUID(), time, time, id),
  ]);
  if (!out[0].meta.changes) throw new ApiError(409, "revision_conflict");
  return { id, status: "pending_review", revision: 1 };
}
