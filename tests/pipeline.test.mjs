import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import worker, { app } from '../worker/index.ts';
import {
  cosine,
  selectTags,
  normalizeUrl,
  renderMarkdown,
  contentHash,
} from '../worker/core.mjs';
import { runJobs, summarize } from '../worker/ai.mjs';
import { discoverVideos } from '../worker/youtube.mjs';
import {
  exportedArticle,
  toStaticArticle,
  exportContent,
} from '../scripts/export-content.mjs';
const migration = await readFile(
  new URL('../migrations/0001_content_pipeline.sql', import.meta.url),
  'utf8',
);
class D1 {
  constructor() {
    this.queries = 0;
    this.sql = new DatabaseSync(':memory:');
    this.sql.exec(migration);
  }
  prepare(query) {
    this.queries++;
    const db = this.sql;
    return {
      params: [],
      bind(...params) {
        this.params = params;
        return this;
      },
      async first() {
        return db.prepare(query).get(...this.params) ?? null;
      },
      async all() {
        return { results: db.prepare(query).all(...this.params) };
      },
      async run() {
        const result = db.prepare(query).run(...this.params);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }
  async batch(items) {
    this.sql.exec('BEGIN');
    try {
      const out = [];
      for (const item of items) out.push(await item.run());
      this.sql.exec('COMMIT');
      return out;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }
}
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
jwk.kid = 'test';
jwk.alg = 'RS256';
const base = 'https://develop-beauty.example.test';
const token = await new SignJWT({ email: 'admin@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test' })
  .setIssuer('https://beauty-test.cloudflareaccess.com')
  .setAudience('test-audience')
  .setExpirationTime('1h')
  .sign(privateKey);
const realFetch = globalThis.fetch;
let geminiCalls = 0,
  geminiQuota = false,
  embeddingCalls = 0,
  fallbackCalls = 0,
  invalidJson = false;
function vector(text) {
  const features = [
    /肌|スキン|保湿/,
    /髪|頭皮|シャンプー/,
    /身体|ボディ/,
    /爪|甘皮/,
    /成分/,
    /乾燥/,
  ];
  const v = Array(1024).fill(0);
  features.forEach((r, i) => {
    v[i] = r.test(text) ? 1 : 0;
  });
  if (!v.some(Boolean)) v[10] = 1;
  return v;
}
const answer = {
  summary:
    '乾燥が気になるときは、使い心地や刺激に配慮しながら保湿を考える内容です。',
  key_points: ['肌の状態を確認する', '出典を読んでケアを選ぶ'],
};
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (url.includes('/cdn-cgi/access/certs'))
    return Response.json({ keys: [jwk] });
  if (url.startsWith('https://generativelanguage.googleapis.com/')) {
    geminiCalls++;
    if (geminiQuota) return new Response('{}', { status: 429 });
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: invalidJson
                  ? 'bad-json'
                  : JSON.stringify(
                      JSON.parse(options?.body || '{}').contents?.[0]
                        ?.parts?.[0]?.fileData
                        ? {
                            ...answer,
                            products: [],
                            ingredients: ['セラミド'],
                            claims: [
                              {
                                claim: '保湿について紹介',
                                evidence:
                                  '動画内の体験談で研究の根拠は示されていない',
                              },
                            ],
                            timestamps: [
                              { time: '0:15', detail: 'ケアの紹介' },
                            ],
                          }
                        : answer,
                    ),
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 80 },
    });
  }
  if (url.includes('/youtube/v3/channels'))
    return Response.json({
      items: [
        {
          id: 'channel-test',
          snippet: { title: 'EGA.channel' },
          contentDetails: { relatedPlaylists: { uploads: 'playlist-test' } },
        },
      ],
    });
  if (url.includes('/youtube/v3/playlistItems'))
    return Response.json({
      items: [{ contentDetails: { videoId: 'abcdefghijk' } }],
    });
  if (url.includes('/youtube/v3/videos'))
    return Response.json({
      items: [
        {
          id: 'abcdefghijk',
          snippet: {
            title: '通常動画も収集',
            liveBroadcastContent: 'none',
            defaultAudioLanguage: 'ja',
          },
          status: { privacyStatus: 'public' },
          contentDetails: { duration: 'PT4M' },
        },
      ],
    });
  throw new Error('Unexpected network request');
};
test.after(() => {
  globalThis.fetch = realFetch;
});
function env(overrides = {}) {
  return {
    DB: new D1(),
    INGEST_API_KEY: 'test-ingest-key',
    CONTENT_EXPORT_KEY: 'test-export-key',
    PIPELINE_ENV: 'development',
    ACCESS_TEAM_DOMAIN: 'https://beauty-test.cloudflareaccess.com',
    ACCESS_AUD: 'test-audience',
    ADMIN_EMAILS: 'admin@example.test',
    GEMINI_API_KEY: 'test-gemini',
    YOUTUBE_API_KEY: 'test-youtube',
    AI: {
      async run(model, input) {
        if (model.includes('bge')) {
          embeddingCalls++;
          return { data: input.text.map(vector) };
        }
        fallbackCalls++;
        return {
          response: JSON.stringify(answer),
          usage: { prompt_tokens: 100, completion_tokens: 80 },
        };
      },
    },
    ASSETS: {
      async fetch() {
        return new Response('not found', { status: 404 });
      },
    },
    ...overrides,
  };
}
async function request(e, path, method = 'GET', body, admin = false) {
  const response = await app.request(
    base + path,
    {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(admin
          ? { 'Cf-Access-Jwt-Assertion': token, Origin: base }
          : { Authorization: 'Bearer test-ingest-key' }),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    e,
  );
  return { response, data: await response.json() };
}
const source = {
  type: 'research',
  source_url: 'https://example.org/paper?utm_source=x',
  author: '研究者',
  title: '肌と保湿の情報',
  raw_summary:
    '肌の乾燥や保湿、成分の情報を紹介する素材です。原文と根拠を確認してください。',
};
function article(id) {
  return {
    slug: 'new-moisture-care',
    title: '乾燥と保湿を考える',
    body_markdown:
      '## 肌の状態\n乾燥を感じたときは使い心地に配慮して保湿を考えます。成分や情報の出典を確認して、無理のないケアを考えるための記事です。',
    excerpt: '保湿を考えるヒントです。',
    category: 'skin',
    tags: [],
    source_ids: [id],
    citations: ['https://example.org/paper'],
    ai_check_notes:
      '原文の根拠を管理者が確認する必要があります。効果は断定していません。',
  };
}
async function submitted(e) {
  const s = await request(e, '/api/ingest/sources', 'POST', source);
  assert.equal(s.response.status, 201);
  const a = await request(
    e,
    '/api/ingest/articles',
    'POST',
    article(s.data.id),
  );
  assert.equal(a.response.status, 201);
  return a.data.id;
}
async function processAll(e) {
  for (let i = 0; i < 10; i++) {
    const jobs = await runJobs(e);
    if (!jobs.length) return;
  }
  throw new Error('Jobs did not finish');
}
test('Botは公開・管理画面にアクセスできず、認証が必要', async () => {
  const e = env();
  assert.equal(
    (await app.request(base + '/api/ingest/sources', {}, e)).status,
    401,
  );
  assert.equal((await app.request(base + '/admin', {}, e)).status, 403);
  assert.equal((await request(e, '/api/admin/articles')).response.status, 403);
  const s = await request(e, '/api/ingest/sources', 'POST', source);
  assert.equal(
    (
      await request(e, '/api/ingest/articles', 'POST', {
        ...article(s.data.id),
        status: 'published',
      })
    ).response.status,
    400,
  );
});
test('出典・確認メモは必須、URL重複と不正な入力を拒否', async () => {
  const e = env(),
    s = await request(e, '/api/ingest/sources', 'POST', source);
  assert.equal(
    (
      await request(e, '/api/ingest/sources', 'POST', {
        ...source,
        source_url: 'https://example.org/paper',
      })
    ).response.status,
    409,
  );
  assert.equal(
    (
      await request(e, '/api/ingest/articles', 'POST', {
        ...article(s.data.id),
        citations: [],
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await request(e, '/api/ingest/articles', 'POST', {
        ...article(s.data.id),
        ai_check_notes: '',
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await request(e, '/api/ingest/articles', 'POST', {
        ...article(s.data.id),
        slug: '../bad',
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await request(e, '/api/ingest/articles', 'POST', {
        ...article(s.data.id),
        slug: 'moisturizer-basics',
      })
    ).response.status,
    409,
  );
});
test('管理者審査までexportに出ない、承認後も私的メモは出ない', async () => {
  const e = env(),
    id = await submitted(e);
  const exportHeaders = {
    Authorization: 'Bearer test-export-key',
    'X-Content-Environment': 'development',
  };
  assert.equal(
    (
      await (
        await app.request(
          base + '/api/published/export',
          { headers: exportHeaders },
          e,
        )
      ).json()
    ).articles.length,
    0,
  );
  await processAll(e);
  const detail = await request(
    e,
    `/api/admin/articles/${id}`,
    'GET',
    null,
    true,
  );
  assert.equal(detail.data.article.ai_status, 'complete');
  assert.ok(detail.data.preview_html.includes('<h2>'));
  const review = await request(
    e,
    `/api/admin/articles/${id}/review`,
    'POST',
    {
      status: 'published',
      revision: detail.data.article.revision,
      confirmed: true,
    },
    true,
  );
  assert.equal(review.response.status, 200);
  assert.equal(review.data.publication.state, 'waiting_configuration');
  const payload = await (
    await app.request(
      base + '/api/published/export',
      { headers: exportHeaders },
      e,
    )
  ).json();
  assert.equal(payload.articles.length, 1);
  assert.ok(!('ai_check_notes' in payload.articles[0]));
  assert.ok(!('reviewed_by' in payload.articles[0]));
  assert.equal(exportedArticle.safeParse(payload.articles[0]).success, true);
  assert.equal(toStaticArticle(payload.articles[0]).aiAssisted, true);
  assert.equal(
    (
      await request(
        e,
        `/api/admin/articles/${id}/review`,
        'POST',
        {
          status: 'rejected',
          revision: detail.data.article.revision + 1,
          confirmed: true,
        },
        true,
      )
    ).response.status,
    409,
  );
});
test('署名・audience・Origin・確認チェック・最新revisionを検証', async () => {
  const e = env(),
    id = await submitted(e);
  assert.equal(
    (
      await app.request(
        base + '/api/admin/articles',
        { headers: { 'Cf-Access-Jwt-Assertion': token + 'bad' } },
        e,
      )
    ).status,
    403,
  );
  const review = { status: 'published', revision: 1, confirmed: true };
  assert.equal(
    (
      await app.request(
        base + `/api/admin/articles/${id}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cf-Access-Jwt-Assertion': token,
            Origin: 'https://evil.example',
          },
          body: JSON.stringify(review),
        },
        e,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        e,
        `/api/admin/articles/${id}/review`,
        'POST',
        { ...review, confirmed: false },
        true,
      )
    ).response.status,
    400,
  );
  assert.equal(
    (await request(e, `/api/admin/articles/${id}/review`, 'POST', review, true))
      .response.status,
    409,
  );
});
test('保存済み要約・埋め込みを再利用し、タグのしきい値変更は生成を増やさない', async () => {
  const e = env(),
    id = await submitted(e);
  await processAll(e);
  const g = geminiCalls,
    b = embeddingCalls;
  await summarize(e, source.raw_summary);
  const after = geminiCalls;
  await summarize(e, source.raw_summary);
  assert.equal(geminiCalls, after);
  const row = await e.DB.prepare('SELECT * FROM articles WHERE id=?')
    .bind(id)
    .first();
  await e.DB.prepare("UPDATE ai_jobs SET state='queued' WHERE entity_id=?")
    .bind(id)
    .run();
  e.TAG_THRESHOLD = '0.95';
  await runJobs(e);
  assert.equal(geminiCalls, after);
  assert.equal(embeddingCalls, b);
  assert.ok(JSON.parse(row.tags).length <= 5);
  assert.ok(g >= 2);
});
test('生成JSONの再試行は1回だけ、失敗は記録', async () => {
  const e = env();
  invalidJson = true;
  const before = geminiCalls;
  try {
    await assert.rejects(summarize(e, '素材です'), /invalid_summary_json/);
    assert.equal(geminiCalls - before, 2);
  } finally {
    invalidJson = false;
  }
});
test('Gemini制限時は文章だけ代替モデルへ、成功結果も再利用', async () => {
  const e = env();
  geminiQuota = true;
  const before = fallbackCalls;
  try {
    const result = await summarize(e, '肌の乾燥の情報です');
    assert.ok(result.model.includes('qwen'));
    await summarize(e, '肌の乾燥の情報です');
    assert.equal(fallbackCalls - before, 1);
    await assert.rejects(
      summarize(e, '動画', {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        seconds: 10,
      }),
      /gemini_quota/,
    );
  } finally {
    geminiQuota = false;
  }
});
test('1日の上限を超える呼び出しはしない', async () => {
  const e = env({ AI_DAILY_CALL_LIMIT: '0' });
  await submitted(e);
  const before = geminiCalls;
  const jobs = await runJobs(e);
  assert.equal(jobs[0].state, 'deferred');
  assert.equal(geminiCalls, before);
  assert.equal(
    (await e.DB.prepare('SELECT state FROM ai_jobs LIMIT 1').first()).state,
    'deferred',
  );
});
test('通常動画も取り込み、動画IDを重複登録しない', async () => {
  const e = env();
  assert.equal((await discoverVideos(e)).added, 1);
  assert.equal((await discoverVideos(e)).added, 0);
  const row = await e.DB.prepare(
    "SELECT * FROM sources WHERE type='youtube'",
  ).first();
  assert.equal(row.video_seconds, 240);
  assert.equal(row.ai_status, 'queued');
  assert.equal(
    (await request(e, '/api/ingest/sources')).data.sources.length,
    0,
  );
});
test('D1自体も不正な状態遷移・承認なしのpublishedを拒否', async () => {
  const e = env(),
    id = await submitted(e);
  await assert.rejects(
    e.DB.prepare("UPDATE articles SET status='draft' WHERE id=?")
      .bind(id)
      .run(),
  );
  await assert.rejects(
    e.DB.prepare("UPDATE articles SET status='published' WHERE id=?")
      .bind(id)
      .run(),
  );
});
test('回数制限を共有DBで管理', async () => {
  const e = env({ INGEST_REQUESTS_PER_MINUTE: '1' });
  assert.equal((await request(e, '/api/ingest/sources')).response.status, 200);
  assert.equal((await request(e, '/api/ingest/sources')).response.status, 429);
});
test('Markdownのスクリプト・画像・危険なリンクを無効化', () => {
  const html = renderMarkdown(
    '<script>alert(1)</script>\n[x](javascript:alert(1))\n![image](https://tracking.example/a)',
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
});
test('コサイン分類は空配列を許容し、上位5件まで', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([0, 0], [1, 0]), -1);
  assert.deepEqual(
    selectTags([1, 0], [{ label: '髪', vector: [0, 1] }], 0.5),
    [],
  );
  assert.equal(
    selectTags(
      [1, 0],
      Array.from({ length: 10 }, (_, i) => ({
        label: String(i),
        vector: [1, 0],
      })),
      0.5,
    ).length,
    5,
  );
});
test('URLと内容ハッシュを正規化する', async () => {
  assert.equal(normalizeUrl(source.source_url), 'https://example.org/paper');
  assert.equal(
    await contentHash({ title: '肌', raw_summary: 'a  b' }),
    await contentHash({ title: '肌', raw_summary: 'a b' }),
  );
  assert.throws(() => normalizeUrl('javascript:alert(1)'));
});
test('動画の詳細と短い要約を1回で保存し、再処理しても生成し直さない', async () => {
  const e = env();
  await discoverVideos(e);
  const before = geminiCalls;
  await runJobs(e);
  const row = await e.DB.prepare(
    "SELECT * FROM sources WHERE type='youtube'",
  ).first();
  assert.equal(row.ai_status, 'complete');
  const result = JSON.parse(row.raw_summary);
  assert.equal(result.ingredients[0], 'セラミド');
  assert.equal(result.timestamps[0].time, '0:15');
  assert.equal(row.summary, result.summary);
  assert.equal(geminiCalls - before, 1);
  await e.DB.prepare("UPDATE ai_jobs SET state='queued' WHERE entity_id=?")
    .bind(row.id)
    .run();
  await runJobs(e);
  assert.equal(geminiCalls - before, 1);
});
test('本文の変更は再審査・AI処理が必要で、管理者のタグは上書きしない', async () => {
  const e = env(),
    id = await submitted(e);
  await processAll(e);
  const detail = await request(
    e,
    `/api/admin/articles/${id}`,
    'GET',
    null,
    true,
  );
  const original = article(detail.data.sources[0].id),
    body = {
      ...original,
      body_markdown:
        original.body_markdown + '\n新たな資料についても確認してください。',
      tags: ['管理者が選んだタグ'],
      revision: detail.data.article.revision,
    };
  delete body.slug;
  delete body.source_ids;
  assert.equal(
    (await request(e, `/api/admin/articles/${id}`, 'PATCH', body, true))
      .response.status,
    200,
  );
  assert.equal(
    (
      await request(
        e,
        `/api/admin/articles/${id}/review`,
        'POST',
        { status: 'published', revision: body.revision + 1, confirmed: true },
        true,
      )
    ).response.status,
    409,
  );
  await runJobs(e);
  const after = await request(
    e,
    `/api/admin/articles/${id}`,
    'GET',
    null,
    true,
  );
  assert.deepEqual(after.data.article.tags, ['管理者が選んだタグ']);
  assert.equal(after.data.article.ai_status, 'complete');
});
test('同時の同じ要約処理はキャッシュのロックで1回にする', async () => {
  const e = env(),
    before = geminiCalls;
  const results = await Promise.allSettled([
    summarize(e, '同時に入る保湿の素材です'),
    summarize(e, '同時に入る保湿の素材です'),
  ]);
  assert.equal(geminiCalls - before, 1);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  assert.ok(
    results.some(
      (r) => r.status === 'rejected' && r.reason.code === 'cache_in_progress',
    ),
  );
});

test('初回のタグ辞書生成もD1無料枠の1処理50クエリ以内', async () => {
  const e = env();
  await submitted(e);
  const before = e.DB.queries;
  await runJobs(e);
  assert.ok(e.DB.queries - before <= 50, String(e.DB.queries - before));
});

test('ビルドの取り込みはキー・環境・公開データの型・slug重複を検証', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beauty-export-test-'));
  const previous = globalThis.fetch;
  const row = {
    id: crypto.randomUUID(),
    slug: 'integration-care',
    title: '確認済み記事',
    body_markdown:
      '## ケアのヒント\n日々の使い心地と出典を確認して選ぶために、記事の主張と根拠を管理者が確認した内容です。',
    excerpt: 'ケアの情報です。',
    category: 'skin',
    tags: [],
    citations: ['https://example.org/source'],
    updated_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    revision: 3,
  };
  const config = {
    CONTENT_PIPELINE_ENABLED: 'true',
    CONTENT_API_URL: base,
    CONTENT_EXPORT_KEY: 'test-key',
    WORKERS_CI_BRANCH: 'develop',
  };
  try {
    await mkdir(join(root, 'src/content/articles'), { recursive: true });
    await assert.rejects(
      exportContent({ ...config, CONTENT_EXPORT_KEY: '' }, root),
      /must be configured/,
    );
    globalThis.fetch = async () =>
      Response.json({ environment: 'production', articles: [row] });
    await assert.rejects(exportContent(config, root), /environment mismatch/);
    globalThis.fetch = async () =>
      Response.json({
        environment: 'development',
        articles: [{ ...row, status: 'pending_review' }],
      });
    await assert.rejects(exportContent(config, root));
    globalThis.fetch = async () =>
      Response.json({ environment: 'development', articles: [row] });
    assert.equal(await exportContent(config, root), 1);
    const content = JSON.parse(
      await readFile(
        join(root, 'src/content/generated-articles/integration-care.json'),
        'utf8',
      ),
    );
    assert.equal(content.aiAssisted, true);
    assert.equal(content.status, 'published');
    await writeFile(
      join(root, 'src/content/articles/integration-care.json'),
      '{}',
    );
    await assert.rejects(exportContent(config, root), /slug collision/);
  } finally {
    globalThis.fetch = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('PreviewではCronを動かさず、本番の収集とAI処理を分ける', async () => {
  let pending;
  const ctx = {
    waitUntil(p) {
      pending = p;
    },
  };
  const preview = env({ ENABLE_SCHEDULED: 'true' });
  worker.scheduled({ cron: '0 0 * * *' }, preview, ctx);
  assert.equal(pending, undefined);
  const production = env({
    PIPELINE_ENV: 'production',
    ENABLE_SCHEDULED: 'true',
  });
  await submitted(production);
  await worker.scheduled({ cron: '0 0 * * *' }, production, ctx);
  await pending;
  assert.equal(
    (
      await production.DB.prepare(
        "SELECT count(*) AS n FROM ai_jobs WHERE state='complete'",
      ).first()
    ).n,
    0,
  );
  await worker.scheduled({ cron: '15 * * * *' }, production, ctx);
  await pending;
  assert.equal(
    (
      await production.DB.prepare(
        "SELECT count(*) AS n FROM ai_jobs WHERE state='complete'",
      ).first()
    ).n,
    1,
  );
});
