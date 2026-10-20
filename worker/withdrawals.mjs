import { z } from "zod";
import { ApiError, now, hash, parse } from "./core.mjs";
import { originalArticles } from "./original-articles.mjs";
import { withdrawalSchema } from "../shared/withdrawal-content.mjs";
export async function withdrawalManifest(env) {
  const rows = await env.DB.prepare(
    "SELECT id,slug FROM article_withdrawals ORDER BY slug",
  ).all();
  return withdrawalSchema.parse({ version: 1, withdrawals: rows.results });
}
export async function monitorWithdrawals(env) {
  let manifest;
  try {
    const r = await fetch(
      "https://my-beauty-palette.com/content-manifest.json",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return;
    manifest = await r.json();
  } catch {
    return;
  }
  if (
    manifest.environment !== "production" ||
    !Array.isArray(manifest.withdrawals)
  )
    return;
  const hidden = withdrawalSchema.safeParse({
    version: 1,
    withdrawals: manifest.withdrawals,
  });
  if (!hidden.success) return;
  const waiting=(await env.DB.prepare("SELECT id,slug FROM article_withdrawals WHERE state='building' ORDER BY updated_at LIMIT 40").all()).results;
  const published=new Set(hidden.data.withdrawals.map(row=>row.id+':'+row.slug));
  for (const row of waiting.filter(row=>published.has(row.id+':'+row.slug))) {
    await env.DB.prepare(
      "UPDATE article_withdrawals SET state='withdrawn',updated_at=? WHERE id=? AND slug=? AND state='building'",
    )
      .bind(now(), row.id, row.slug)
      .run();
  }
}
async function catalog(env) {
  const originals = await Promise.all(
    originalArticles
      .filter((row) => row.data.status === "published")
      .map(async (row) => ({
        slug: row.slug,
        title: row.data.title,
        excerpt: row.data.summary,
        category: row.data.category,
        revision_token: "static:" + (await hash(JSON.stringify(row.data))),
        article_id: null,
        origin: "initial",
      })),
  );
  const rows = (
    await env.DB.prepare(
      "SELECT id,slug,title,excerpt,category,revision,original_slug FROM articles a WHERE a.status='published' OR a.original_slug IS NOT NULL OR EXISTS(SELECT 1 FROM publication_jobs p WHERE p.article_id=a.id)",
    ).all()
  ).results;
  return [
    ...originals.map(initial=>{
      const revision=rows.find(row=>row.original_slug===initial.slug);
      return revision?{...initial,title:revision.title,excerpt:revision.excerpt,article_id:revision.id,revision_token:'db:'+revision.revision}:initial;
    }),
    ...rows
      .filter((row) => !originals.some((item) => item.slug === row.slug))
      .map((row) => ({
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        category: row.category,
        revision_token: "db:" + row.revision,
        article_id: row.id,
        origin: "ai",
      })),
  ];
}
export async function publications(env, query) {
  await monitorWithdrawals(env);
  const status = query.status || "all",
    limit = Number(query.limit || 20),
    offset = Number(query.offset || 0),
    q = (query.q || "").trim().toLowerCase();
  if (
    !["all", "visible", "withdrawn"].includes(status) ||
    ![10, 20, 50].includes(limit) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    q.length > 200
  )
    throw new ApiError(400, "invalid_filters");
  const flags = (
    await env.DB.prepare("SELECT * FROM article_withdrawals").all()
  ).results;
  const items = (await catalog(env))
    .map((row) => ({
      ...row,
      withdrawal: flags.find((flag) => flag.slug === row.slug) || null,
    }))
    .filter(
      (row) =>
        (status === "all" ||
          (status === "visible" ? !row.withdrawal : !!row.withdrawal)) &&
        (!q || (row.title + " " + row.slug).toLowerCase().includes(q)),
    )
    .sort((a, b) => a.title.localeCompare(b.title, "ja"));
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
const inputSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    revision_token: z.string().max(100),
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
  })
  .strict();
export async function requestWithdrawal(env, input, actor) {
  const data = parse(inputSchema, input);
  const previous = await env.DB.prepare(
    "SELECT * FROM article_withdrawals WHERE slug=?",
  )
    .bind(data.slug)
    .first();
  if (previous) return { id: previous.id, state: previous.state };
  const current = (await catalog(env)).find((row) => row.slug === data.slug);
  if (!current) throw new ApiError(404, "publication_not_found");
  if (current.revision_token !== data.revision_token)
    throw new ApiError(409, "revision_conflict");
  const id = crypto.randomUUID(),
    time = now();
  const sql = current.article_id
    ? "INSERT OR IGNORE INTO article_withdrawals(id,slug,article_id,revision_token,reason,actor,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? FROM articles WHERE id=? AND revision=?"
    : "INSERT OR IGNORE INTO article_withdrawals(id,slug,article_id,revision_token,reason,actor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)";
  const values = [
    id,
    data.slug,
    current.article_id,
    data.revision_token,
    data.reason,
    actor,
    time,
    time,
  ];
  if (current.article_id)
    values.push(current.article_id, Number(data.revision_token.slice(3)));
  await env.DB.prepare(sql)
    .bind(...values)
    .run();
  const stored = await env.DB.prepare(
    "SELECT id,state FROM article_withdrawals WHERE slug=?",
  )
    .bind(data.slug)
    .first();
  if (!stored) throw new ApiError(409, "revision_conflict");
  return stored;
}
const syncedSchema = z
  .object({
    withdrawals: withdrawalSchema.shape.withdrawals.max(40),
    main_sha: z.string().regex(/^[0-9a-f]{40}$/),
    build_id: z.uuid(),
  })
  .strict();
export async function markWithdrawalBuild(env, body) {
  const data = parse(syncedSchema, body),
    time = now();
  const statements = data.withdrawals.map((row) =>
    env.DB.prepare(
      "UPDATE article_withdrawals SET state=CASE WHEN state='withdrawn' THEN state ELSE 'building' END,main_sha=?,build_id=?,updated_at=? WHERE id=? AND slug=?",
    ).bind(data.main_sha, data.build_id, time, row.id, row.slug),
  );
  if (statements.length) await env.DB.batch(statements);
  return { ok: true };
}
