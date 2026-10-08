import { Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type {
  D1Database,
  Ai,
  Fetcher,
  ScheduledController,
  ExecutionContext,
} from '@cloudflare/workers-types';
import {
  ApiError,
  now,
  secureEqual,
  parse,
  sourceInput,
  articleInput,
  editInput,
  normalizeUrl,
  contentHash,
  decode,
  rateLimit,
  renderMarkdown,
  reviewFlags,
} from './core.mjs';
import { settings, tags } from './config.mjs';
import { runJobs } from './ai.mjs';
import { discoverVideos } from './youtube.mjs';
import { adminPage } from './admin.mjs';
import { triggerBuild, monitorBuilds } from './publish.mjs';
type Env = { DB: D1Database; AI: Ai; ASSETS: Fetcher; [key: string]: any };
const app = new Hono<{ Bindings: Env; Variables: { admin: string } }>();
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
async function json(c: any) {
  if (!c.req.header('Content-Type')?.startsWith('application/json'))
    throw new ApiError(415, 'json_required');
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 262144) {
      await reader.cancel();
      throw new ApiError(413, 'request_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
}
const jobStatement = (
  db: D1Database,
  type: string,
  id: string,
  hash: string,
  time: string,
) =>
  db
    .prepare(
      'INSERT OR IGNORE INTO ai_jobs(id,entity_type,entity_id,content_hash,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(crypto.randomUUID(), type, id, hash, time, time);
app.onError((error: any, c) => {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'internal_error';
  if (status === 500)
    console.error(
      JSON.stringify({ event: 'request_failed', path: c.req.path }),
    );
  return c.json({ error: { code } }, status as any);
});
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!c.env.DB) throw new ApiError(503, 'database_not_configured');
  await next();
});
app.use('/api/ingest/*', async (c, next) => {
  if (
    !(await secureEqual(
      c.req.header('Authorization'),
      c.env.INGEST_API_KEY ? `Bearer ${c.env.INGEST_API_KEY}` : null,
    ))
  )
    throw new ApiError(401, 'unauthorized');
  await rateLimit(c.env.DB, settings(c.env).ingestPerMinute);
  await next();
});
const adminAuth = async (c: any, next: any) => {
  const env = c.env;
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAILS)
    throw new ApiError(403, 'admin_access_required');
  try {
    const domain = new URL(env.ACCESS_TEAM_DOMAIN);
    if (
      domain.protocol !== 'https:' ||
      !domain.hostname.endsWith('.cloudflareaccess.com')
    )
      throw new Error();
    const url = new URL('/cdn-cgi/access/certs', domain).href;
    let keys = jwks.get(url);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(url));
      jwks.set(url, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer: domain.origin,
      audience: env.ACCESS_AUD,
    });
    const email =
      typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (
      !env.ADMIN_EMAILS.split(',')
        .map((v: string) => v.trim().toLowerCase())
        .includes(email) ||
      !email
    )
      throw new Error();
    c.set('admin', email);
  } catch {
    throw new ApiError(403, 'admin_access_required');
  }
  if (
    !['GET', 'HEAD'].includes(c.req.method) &&
    c.req.header('Origin') !== new URL(c.req.url).origin
  )
    throw new ApiError(403, 'invalid_origin');
  await next();
};
app.use('/admin', adminAuth);
app.use('/admin/*', adminAuth);
app.use('/api/admin/*', adminAuth);
app.get('/admin', (c) => {
  c.header('Cache-Control', 'no-store');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  c.header('X-Robots-Tag', 'noindex, nofollow');
  return c.html(adminPage());
});
app.get('/admin/', (c) => c.redirect('/admin', 302));
app.get('/api/ingest/health', (c) =>
  c.json({ environment: c.env.PIPELINE_ENV }),
);
app.get('/api/ingest/sources', async (c) => {
  const status = c.req.query('status') ?? 'new';
  if (!['new', 'used', 'rejected'].includes(status))
    throw new ApiError(400, 'invalid_status');
  const offset = Math.max(0, Number(c.req.query('offset') || 0));
  if (!Number.isInteger(offset) || offset > 100000)
    throw new ApiError(400, 'invalid_offset');
  const rows = (
    await c.env.DB.prepare(
      "SELECT * FROM sources WHERE status=? AND raw_summary!='' ORDER BY fetched_at,id LIMIT 51 OFFSET ?",
    )
      .bind(status, offset)
      .all()
  ).results;
  return c.json({
    sources: rows.slice(0, 50).map(decode),
    next_offset: rows.length > 50 ? offset + 50 : null,
  });
});
app.post('/api/ingest/sources', async (c) => {
  const data = parse(sourceInput, await json(c)),
    id = crypto.randomUUID(),
    time = now(),
    url = normalizeUrl(data.source_url),
    hash = await contentHash(data);
  const exists = await c.env.DB.prepare(
    'SELECT id FROM sources WHERE source_url=?',
  )
    .bind(url)
    .first();
  if (exists) throw new ApiError(409, 'duplicate_source');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO sources(id,type,source_url,author,title,raw_summary,language,fetched_at,content_hash) VALUES(?,?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        data.type,
        url,
        data.author,
        data.title,
        data.raw_summary,
        data.language,
        time,
        hash,
      ),
      jobStatement(c.env.DB, 'source', id, hash, time),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new ApiError(409, 'duplicate_source');
    throw error;
  }
  return c.json({ id, status: 'new', ai_status: 'queued' }, 201);
});
app.patch('/api/ingest/sources/:id', async (c) => {
  const body = await json(c);
  if (
    Object.keys(body).length !== 1 ||
    !['used', 'rejected'].includes(body.status)
  )
    throw new ApiError(400, 'invalid_input');
  const result = await c.env.DB.prepare(
    "UPDATE sources SET status=? WHERE id=? AND status='new'",
  )
    .bind(body.status, c.req.param('id'))
    .run();
  if (!result.meta.changes) throw new ApiError(409, 'source_not_new');
  return c.json({ id: c.req.param('id'), status: body.status });
});
app.post('/api/ingest/articles', async (c) => {
  const data = parse(articleInput, await json(c)),
    id = crypto.randomUUID(),
    time = now(),
    hash = await contentHash(data);
  data.ai_check_notes =
    data.ai_check_notes.split('\n\n[サイトの確認事項]')[0] +
    '\n\n[サイトの確認事項]\n' +
    reviewFlags(data).join('\n');
  const sourceIds = [...new Set(data.source_ids)] as string[];
  for (const source of sourceIds) {
    if (
      !(await c.env.DB.prepare(
        "SELECT id FROM sources WHERE id=? AND status!='rejected' AND raw_summary!=''",
      )
        .bind(source)
        .first())
    )
      throw new ApiError(400, 'invalid_source_id');
  }
  if (
    await c.env.DB.prepare('SELECT id FROM articles WHERE slug=?')
      .bind(data.slug)
      .first()
  )
    throw new ApiError(409, 'duplicate_slug');
  if (
    [
      'moisturizer-basics',
      'hair-washing-basics',
      'reading-ingredient-information',
      'body-moisturizing-basics',
      'nail-care-basics',
      'mens-care-basics',
      'choosing-by-ingredients-draft',
    ].includes(data.slug)
  )
    throw new ApiError(409, 'reserved_slug');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO articles(id,slug,title,body_markdown,excerpt,category,tags,citations,ai_check_notes,created_at,updated_at,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        data.slug,
        data.title,
        data.body_markdown,
        data.excerpt,
        data.category,
        JSON.stringify(data.tags),
        JSON.stringify(data.citations.map(normalizeUrl)),
        data.ai_check_notes,
        time,
        time,
        hash,
      ),
      ...sourceIds.map((source) =>
        c.env.DB.prepare(
          'INSERT INTO article_sources(article_id,source_id) VALUES(?,?)',
        ).bind(id, source),
      ),
      c.env.DB.prepare(
        "UPDATE articles SET status='pending_review' WHERE id=?",
      ).bind(id),
      c.env.DB.prepare(
        'INSERT INTO review_events(article_id,actor,action,revision,created_at) VALUES(?,?,?,?,?)',
      ).bind(id, 'ingest', 'submitted', 1, time),
      jobStatement(c.env.DB, 'article', id, hash, time),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new ApiError(409, 'duplicate_slug');
    throw error;
  }
  return c.json({ id, status: 'pending_review', ai_status: 'queued' }, 201);
});
app.get('/api/admin/articles', async (c) => {
  await monitorBuilds(c.env);
  const status = c.req.query('status') ?? 'pending_review';
  if (!['pending_review', 'published', 'rejected'].includes(status))
    throw new ApiError(400, 'invalid_status');
  const offset = Number(c.req.query('offset') || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new ApiError(400, 'invalid_offset');
  const rows = (
    await c.env.DB.prepare(
      'SELECT id,slug,title,status,ai_status,updated_at,revision FROM articles WHERE status=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?',
    )
      .bind(status, offset)
      .all()
  ).results;
  return c.json({
    articles: rows.slice(0, 50),
    next_offset: rows.length > 50 ? offset + 50 : null,
  });
});
app.get('/api/admin/articles/:id', async (c) => {
  await monitorBuilds(c.env);
  const row: any = await c.env.DB.prepare('SELECT * FROM articles WHERE id=?')
    .bind(c.req.param('id'))
    .first();
  if (!row) throw new ApiError(404, 'article_not_found');
  const sources = (
    await c.env.DB.prepare(
      'SELECT s.* FROM sources s JOIN article_sources r ON r.source_id=s.id WHERE r.article_id=?',
    )
      .bind(row.id)
      .all()
  ).results.map(decode);
  const events = (
    await c.env.DB.prepare(
      'SELECT actor,action,revision,created_at FROM review_events WHERE article_id=? ORDER BY id',
    )
      .bind(row.id)
      .all()
  ).results;
  const publication = await c.env.DB.prepare(
    'SELECT * FROM publication_jobs WHERE article_id=? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(row.id)
    .first();
  return c.json({
    article: decode(row),
    sources,
    events,
    publication,
    preview_html: renderMarkdown(row.body_markdown),
    review_flags: reviewFlags(row),
  });
});
app.patch('/api/admin/articles/:id', async (c) => {
  const input = await json(c);
  if (typeof input.ai_check_notes === 'string')
    input.ai_check_notes =
      input.ai_check_notes.split('\n\n[サイトの確認事項]')[0];
  const data = parse(editInput, input),
    hash = await contentHash(data),
    time = now(),
    id = c.req.param('id');
  data.ai_check_notes +=
    '\n\n[サイトの確認事項]\n' + reviewFlags(data).join('\n');
  const row: any = await c.env.DB.prepare(
    'SELECT status,revision,content_hash FROM articles WHERE id=?',
  )
    .bind(id)
    .first();
  if (!row) throw new ApiError(404, 'article_not_found');
  if (row.status !== 'pending_review' || row.revision !== data.revision)
    throw new ApiError(409, 'revision_conflict');
  const mutation = crypto.randomUUID();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE articles SET title=?,body_markdown=?,excerpt=?,category=?,tags=?,citations=?,ai_check_notes=?,metadata_edited=1,content_hash=?,ai_status=CASE WHEN content_hash=? THEN ai_status ELSE 'queued' END,updated_at=?,revision=revision+1,mutation_token=? WHERE id=? AND revision=? AND status='pending_review'",
    ).bind(
      data.title,
      data.body_markdown,
      data.excerpt,
      data.category,
      JSON.stringify(data.tags),
      JSON.stringify(data.citations.map(normalizeUrl)),
      data.ai_check_notes,
      hash,
      hash,
      time,
      mutation,
      id,
      data.revision,
    ),
    c.env.DB.prepare(
      'INSERT INTO review_events(article_id,actor,action,revision,created_at) SELECT id,?,?,revision,? FROM articles WHERE id=? AND mutation_token=?',
    ).bind(c.get('admin'), 'edited', time, id, mutation),
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO ai_jobs(id,entity_type,entity_id,content_hash,next_attempt_at,created_at) SELECT ?,?,?,?,?,? FROM articles WHERE id=? AND mutation_token=?',
    ).bind(crypto.randomUUID(), 'article', id, hash, time, time, id, mutation),
  ]);
  if (!results[0].meta.changes) throw new ApiError(409, 'revision_conflict');
  return c.json({ id, revision: data.revision + 1 });
});
app.post('/api/admin/articles/:id/review', async (c) => {
  const body = await json(c);
  if (
    !['published', 'rejected'].includes(body.status) ||
    !Number.isInteger(body.revision) ||
    body.confirmed !== true ||
    Object.keys(body).some(
      (k) => !['status', 'revision', 'confirmed'].includes(k),
    )
  )
    throw new ApiError(400, 'review_confirmation_required');
  const id = c.req.param('id'),
    time = now(),
    actor = c.get('admin');
  const row: any = await c.env.DB.prepare(
    "SELECT * FROM articles WHERE id=? AND revision=? AND status='pending_review'",
  )
    .bind(id, body.revision)
    .first();
  if (!row) throw new ApiError(409, 'revision_conflict');
  if (body.status === 'published' && row.ai_status !== 'complete')
    throw new ApiError(409, 'ai_processing_incomplete');
  if (body.status === 'published') {
    const cited = JSON.parse(row.citations);
    if (
      !cited.some(
        (u: string) =>
          ![
            'x.com',
            'www.x.com',
            'twitter.com',
            'www.twitter.com',
            'youtube.com',
            'www.youtube.com',
            'youtu.be',
          ].includes(new URL(u).hostname),
      )
    )
      throw new ApiError(400, 'independent_citation_required');
    const rejected = await c.env.DB.prepare(
      "SELECT s.id FROM sources s JOIN article_sources r ON r.source_id=s.id WHERE r.article_id=? AND s.status='rejected' LIMIT 1",
    )
      .bind(id)
      .first();
    if (rejected) throw new ApiError(400, 'rejected_source');
  }
  const publicationId = crypto.randomUUID();
  const statements = [
    c.env.DB.prepare(
      "UPDATE articles SET status=?,published_at=?,reviewed_by=?,updated_at=?,revision=revision+1,mutation_token=? WHERE id=? AND revision=? AND status='pending_review'",
    ).bind(
      body.status,
      body.status === 'published' ? time : null,
      actor,
      time,
      publicationId,
      id,
      body.revision,
    ),
    c.env.DB.prepare(
      'INSERT INTO review_events(article_id,actor,action,revision,created_at) SELECT id,?,?,revision,? FROM articles WHERE id=? AND mutation_token=?',
    ).bind(actor, body.status, time, id, publicationId),
  ];
  if (body.status === 'published')
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO publication_jobs(id,article_id,created_at,updated_at) SELECT ?,id,?,? FROM articles WHERE id=? AND status='published' AND mutation_token=?",
      ).bind(publicationId, time, time, id, publicationId),
    );
  const results = await c.env.DB.batch(statements);
  if (!results[0].meta.changes) throw new ApiError(409, 'revision_conflict');
  const publication =
    body.status === 'published'
      ? await triggerBuild(c.env, { id: publicationId })
      : null;
  return c.json({ id, status: body.status, publication });
});
app.post('/api/admin/articles/:id/retry-build', async (c) => {
  await monitorBuilds(c.env);
  const job: any = await c.env.DB.prepare(
    "SELECT * FROM publication_jobs WHERE article_id=? AND state!='deployed' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(c.req.param('id'))
    .first();
  if (!job) throw new ApiError(404, 'publication_not_pending');
  return c.json(await triggerBuild(c.env, job));
});
app.post('/api/admin/jobs/run', async (c) =>
  c.json({ jobs: await runJobs(c.env) }),
);
app.post('/api/admin/youtube/discover', async (c) => {
  try {
    return c.json(await discoverVideos(c.env));
  } catch {
    return c.json({ error: { code: 'youtube_discovery_failed' } }, 502);
  }
});
app.post('/api/admin/jobs/:id/retry', async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE ai_jobs SET state='queued',next_attempt_at=?,error_code=NULL WHERE id=? AND state='failed'",
  )
    .bind(now(), c.req.param('id'))
    .run();
  if (!result.meta.changes) throw new ApiError(409, 'job_not_failed');
  return c.json({ state: 'queued' });
});
app.get('/api/admin/operations', async (c) => {
  const jobs = (
    await c.env.DB.prepare(
      "SELECT id,entity_type,state,error_code,attempts,next_attempt_at FROM ai_jobs WHERE state NOT IN ('complete','obsolete') ORDER BY created_at LIMIT 50",
    ).all()
  ).results;
  const sources = (
    await c.env.DB.prepare(
      'SELECT id,title,type,ai_status,status,video_seconds FROM sources ORDER BY fetched_at DESC LIMIT 20',
    ).all()
  ).results;
  const usage = await c.env.DB.prepare('SELECT * FROM daily_budget WHERE day=?')
    .bind(now().slice(0, 10))
    .first();
  const calls = (
    await c.env.DB.prepare(
      'SELECT provider,model,outcome,input_tokens,output_tokens,usage_estimated FROM ai_usage WHERE day=? ORDER BY created_at DESC LIMIT 30',
    )
      .bind(now().slice(0, 10))
      .all()
  ).results;
  const channels = (
    await c.env.DB.prepare('SELECT * FROM channels ORDER BY title').all()
  ).results;
  return c.json({
    jobs,
    sources,
    usage,
    calls,
    channels,
    settings: settings(c.env),
    tags,
  });
});
app.post('/api/admin/channels', async (c) => {
  const body = await json(c);
  if (
    typeof body.handle !== 'string' ||
    !/^@[^\s/\\?#]{1,100}$/.test(body.handle)
  )
    throw new ApiError(400, 'invalid_channel');
  try {
    await c.env.DB.prepare(
      "INSERT INTO channels(id,handle,title,enabled,state) VALUES(?,?,?,1,'approved')",
    )
      .bind(crypto.randomUUID(), body.handle, body.handle)
      .run();
  } catch {
    throw new ApiError(409, 'duplicate_channel');
  }
  return c.json({ state: 'approved' }, 201);
});
app.patch('/api/admin/channels/:id', async (c) => {
  const body = await json(c);
  if (typeof body.enabled !== 'boolean')
    throw new ApiError(400, 'invalid_input');
  const result = await c.env.DB.prepare(
    'UPDATE channels SET enabled=? WHERE id=?',
  )
    .bind(body.enabled ? 1 : 0, c.req.param('id'))
    .run();
  if (!result.meta.changes) throw new ApiError(404, 'channel_not_found');
  return c.json({ enabled: body.enabled });
});
app.get('/api/published/export', async (c) => {
  if (
    !(await secureEqual(
      c.req.header('Authorization'),
      c.env.CONTENT_EXPORT_KEY ? `Bearer ${c.env.CONTENT_EXPORT_KEY}` : null,
    ))
  )
    throw new ApiError(401, 'unauthorized');
  if (c.req.header('X-Content-Environment') !== c.env.PIPELINE_ENV)
    throw new ApiError(409, 'environment_mismatch');
  const rows = (
    await c.env.DB.prepare(
      "SELECT id,slug,title,body_markdown,excerpt,category,tags,citations,updated_at,published_at,revision FROM articles WHERE status='published' AND published_at IS NOT NULL AND reviewed_by IS NOT NULL ORDER BY published_at DESC",
    ).all()
  ).results;
  return c.json({
    environment: c.env.PIPELINE_ENV,
    articles: rows.map(decode),
  });
});
app.all('/api/*', (c) => c.json({ error: { code: 'not_found' } }, 404));
app.all('*', async (c) => c.env.ASSETS.fetch(c.req.raw as any) as any);
export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    if (env.PIPELINE_ENV !== 'production' || env.ENABLE_SCHEDULED !== 'true')
      return;
    ctx.waitUntil(
      (async () => {
        try {
          if (_controller.cron === '0 0 * * *') {
            await discoverVideos(env);
            return;
          }
        } catch {
          console.error(JSON.stringify({ event: 'youtube_discovery_failed' }));
        }
        if (_controller.cron === '0 0 * * *') return;
        await runJobs(env);
        await monitorBuilds(env);
        await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?')
          .bind(now())
          .run();
      })(),
    );
  },
};
export { app };
