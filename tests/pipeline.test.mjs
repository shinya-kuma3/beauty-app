import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from 'node:fs/promises';
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
const editorMigration = await readFile(
  new URL('../migrations/0002_editor_dashboard.sql', import.meta.url),
  'utf8',
);
const roleMigration = await readFile(
  new URL('../migrations/0003_ai_roles.sql', import.meta.url),
  'utf8',
);
const searchMigration = await readFile(
  new URL('../migrations/0004_article_search.sql', import.meta.url),
  'utf8',
);
const releaseMigration = await readFile(
  new URL('../migrations/0005_content_releases.sql', import.meta.url),
  'utf8',
);
const feedbackMigration=await readFile(new URL('../migrations/0006_feedback.sql',import.meta.url),'utf8');
const withdrawalMigration=await readFile(new URL('../migrations/0007_article_withdrawals.sql',import.meta.url),'utf8');
const billingMigration = await readFile(new URL('../migrations/0008_billing_dashboard.sql', import.meta.url), 'utf8');
class D1 {
  constructor() {
    this.queries = 0;
    this.sql = new DatabaseSync(':memory:');
    this.sql.exec(migration);
    this.sql.exec(editorMigration);
    this.sql.exec(roleMigration);
    this.sql.exec(searchMigration);
    this.sql.exec(releaseMigration);
    this.sql.exec(feedbackMigration);
    this.sql.exec(withdrawalMigration);
    this.sql.exec(billingMigration);
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
const editorToken = await new SignJWT({ email: 'editor@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test' })
  .setIssuer('https://beauty-test.cloudflareaccess.com')
  .setAudience('test-audience')
  .setExpirationTime('1h')
  .sign(privateKey);
const reviewAnswer = {
  overview: '効能の断定と出典を確認してください。',
  findings: [
    {
      severity: 'warning',
      category: 'evidence',
      quote: '',
      reason: '原文の根拠を人が確認する必要があります。',
      suggestion: '出典の内容と記事の主張を照合してください。',
    },
  ],
  questions: ['原文は保湿の主張を支えていますか？'],
};
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
  if(url==='https://my-beauty-palette.com/content-manifest.json')return Response.json({environment:'production',withdrawals:[]});
  if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    const data = JSON.parse(options.body);
    if (data.response === "unavailable")
      return new Response("", { status: 503 });
    return Response.json({
      success: data.response !== "invalid",
      hostname:
        data.response === "wrong-host"
          ? "evil.example"
          : "develop-beauty-app.sinyak4649.workers.dev",
      action: data.response === "wrong-action" ? "login" : "feedback",
    });
  }
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
                      JSON.parse(
                        options?.body || '{}',
                      ).systemInstruction?.parts?.[0]?.text?.startsWith(
                        '美容記事',
                      )
                        ? reviewAnswer
                        : JSON.parse(options?.body || '{}').contents?.[0]
                              ?.parts?.[0]?.fileData
                          ? {
                              ...answer,
                              products: [],
                              terms: [
                                {
                                  original: 'ceramide',
                                  japanese: 'セラミド',
                                  language: 'en',
                                },
                              ],
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
          contentDetails: {
            relatedPlaylists: { uploads: 'playlist-test' },
          },
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
          ? {
              'Cf-Access-Jwt-Assertion':
                admin === 'editor' ? editorToken : token,
              Origin: base,
            }
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
  assert.equal(
    (await request(e, '/api/admin/articles')).response.status,
    403,
  );
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
  assert.equal(
    exportedArticle.safeParse(payload.articles[0]).success,
    true,
  );
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
    (
      await request(
        e,
        `/api/admin/articles/${id}/review`,
        'POST',
        review,
        true,
      )
    ).response.status,
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
  await e.DB.prepare(
    "UPDATE ai_jobs SET state='queued' WHERE entity_id=?",
  )
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
    await assert.rejects(
      summarize(e, '素材です'),
      /invalid_summary_json/,
    );
    assert.equal(geminiCalls - before, 2);
  } finally {
    invalidJson = false;
  }
});
test('Gemini制限時は要約を待機し、Workers AIで文章を生成しない', async () => {
  const e = env({ SUMMARY_PROVIDER: 'workers' }),
    before = fallbackCalls;
  geminiQuota = true;
  try {
    await assert.rejects(summarize(e, '保湿の要約'), /gemini_quota/);
    await assert.rejects(
      summarize(e, '動画', {
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        seconds: 10,
      }),
      /gemini_quota/,
    );
    assert.equal(fallbackCalls, before);
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
    (await e.DB.prepare('SELECT state FROM ai_jobs LIMIT 1').first())
      .state,
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
  assert.equal(
    (await request(e, '/api/ingest/sources')).response.status,
    200,
  );
  assert.equal(
    (await request(e, '/api/ingest/sources')).response.status,
    429,
  );
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
  assert.equal(
    normalizeUrl(source.source_url),
    'https://example.org/paper',
  );
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
  assert.equal(result.terms[0].original, 'ceramide');
  assert.equal(result.terms[0].japanese, 'セラミド');
  assert.equal(result.timestamps[0].time, '0:15');
  assert.equal(row.summary, result.summary);
  assert.equal(geminiCalls - before, 1);
  await e.DB.prepare(
    "UPDATE ai_jobs SET state='queued' WHERE entity_id=?",
  )
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
        original.body_markdown +
        '\n新たな資料についても確認してください。',
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
        {
          status: 'published',
          revision: body.revision + 1,
          confirmed: true,
        },
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
  for (const r of results)
    if (r.status === 'rejected')
      assert.equal(r.reason.code, 'cache_in_progress');
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
    await assert.rejects(
      exportContent(config, root),
      /environment mismatch/,
    );
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
        join(
          root,
          'src/content/generated-articles/integration-care.json',
        ),
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

test('編集者は記事を編集・公開できるが、編集者追加・収集設定は管理者だけ', async () => {
  const e = env(),
    id = await submitted(e);
  await processAll(e);
  assert.equal(
    (
      await request(
        e,
        '/api/admin/editors',
        'POST',
        { email: 'editor@example.test', active: true },
        true,
      )
    ).response.status,
    200,
  );
  assert.equal(
    (await request(e, '/api/admin/me', 'GET', null, 'editor')).data.role,
    'editor',
  );
  for (const [path, method, body] of [
    ['editors', 'GET', null],
    ['editors', 'POST', { email: 'other@example.test', active: true }],
    ['operations', 'GET', null],
    ['jobs/run', 'POST', {}],
    ['channels', 'POST', { handle: '@someone' }],
  ])
    assert.equal(
      (await request(e, '/api/admin/' + path, method, body, 'editor'))
        .response.status,
      403,
    );
  let row = (
    await request(e, '/api/admin/articles/' + id, 'GET', null, 'editor')
  ).data.article;
  const edited = {
    ...article('unused'),
    title: '編集者の修正',
    revision: row.revision,
  };
  delete edited.slug;
  delete edited.source_ids;
  assert.equal(
    (
      await request(
        e,
        '/api/admin/articles/' + id,
        'PATCH',
        edited,
        'editor',
      )
    ).response.status,
    200,
  );
  await runJobs(e, { id, kind: 'enrich' });
  row = (
    await request(e, '/api/admin/articles/' + id, 'GET', null, 'editor')
  ).data.article;
  assert.equal(
    (
      await request(
        e,
        '/api/admin/articles/' + id + '/review',
        'POST',
        { status: 'published', revision: row.revision, confirmed: true },
        'editor',
      )
    ).response.status,
    200,
  );
  assert.equal(
    e.DB.sql
      .prepare('SELECT reviewed_by FROM articles WHERE id=?')
      .get(id).reviewed_by,
    'editor@example.test',
  );
});
test('停止した編集者を毎回拒否し、管理者の削除や自己昇格を許さない', async () => {
  const e = env();
  await request(
    e,
    '/api/admin/editors',
    'POST',
    { email: 'editor@example.test', active: true },
    true,
  );
  assert.equal(
    (
      await request(
        e,
        '/api/admin/editors',
        'POST',
        { email: 'admin@example.test', active: false },
        true,
      )
    ).response.status,
    400,
  );
  await request(
    e,
    '/api/admin/editors',
    'POST',
    { email: 'editor@example.test', active: false },
    true,
  );
  assert.equal(
    (await request(e, '/api/admin/me', 'GET', null, 'editor')).response
      .status,
    403,
  );
  assert.equal(
    (await request(e, '/api/admin/me', 'GET', null, true)).response
      .status,
    200,
  );
});

async function checkRequest(e, id) {
  const row = (
    await request(e, '/api/admin/articles/' + id, 'GET', null, true)
  ).data.article;
  return (
    await request(
      e,
      '/api/admin/articles/' + id + '/ai-check',
      'POST',
      { revision: row.revision },
      true,
    )
  ).data;
}
function grokResult(revision) {
  return {
    ...reviewAnswer,
    revision,
    ai_check_notes:
      '一次資料と照合しました。研究条件と効能の断定には注意が必要です。',
    checked_citations: ['https://example.org/paper'],
    primary_source_notes: '一次資料の内容と研究条件を確認しました。',
    pr_notes: 'PRかどうかは原文の開示を確認してください。',
    terms: [
      { original: 'ceramide', japanese: 'セラミド', language: 'en' },
    ],
  };
}
test('Grok再チェックの依頼・取得・返信は公開せず、本文を変えず、重複返信を再利用する', async () => {
  const e = env(),
    id = await submitted(e),
    before = geminiCalls,
    workers = fallbackCalls;
  const queued = await checkRequest(e, id);
  assert.equal(queued.state, 'pending');
  const list = (await request(e, '/api/ingest/checks?status=pending'))
    .data;
  assert.equal(list.requests.length, 1);
  assert.equal(list.requests[0].id, queued.id);
  assert.equal(
    list.requests[0].article.body_markdown,
    article('unused').body_markdown,
  );
  assert.ok(list.requests[0].article.materials[0].raw_summary);
  assert.equal(list.requests[0].requested_by, undefined);
  const payload = grokResult(list.requests[0].revision);
  const bad = await request(
    e,
    '/api/ingest/checks/' + queued.id + '/result',
    'POST',
    { ...payload, status: 'published' },
  );
  assert.equal(bad.response.status, 400);
  const result = await request(
    e,
    '/api/ingest/checks/' + queued.id + '/result',
    'POST',
    payload,
  );
  assert.equal(result.response.status, 200);
  assert.equal(
    (
      await request(
        e,
        '/api/ingest/checks/' + queued.id + '/result',
        'POST',
        payload,
      )
    ).data.cached,
    true,
  );
  const detail = (
    await request(e, '/api/admin/articles/' + id, 'GET', null, true)
  ).data;
  assert.equal(detail.article.status, 'pending_review');
  assert.equal(
    detail.article.body_markdown,
    article('unused').body_markdown,
  );
  assert.equal(detail.check.stale, false);
  assert.equal(detail.check.result.terms[0].original, 'ceramide');
  assert.equal(detail.article.revision, 2);
  assert.equal(geminiCalls, before);
  assert.equal(fallbackCalls, workers);
  assert.equal((await checkRequest(e, id)).cached, true);
  assert.equal(
    (await request(e, '/api/ingest/checks?status=pending')).data.requests
      .length,
    0,
  );
});
test('Grokの古い返信は拒否し、編集者の本文やメモを上書きしない', async () => {
  const e = env(),
    id = await submitted(e);
  const queued = await checkRequest(e, id);
  const edit = {
    ...article('unused'),
    revision: 1,
    body_markdown: article('unused').body_markdown + '原文も読みます。',
    ai_check_notes: '編集者のメモ',
  };
  delete edit.slug;
  delete edit.source_ids;
  await request(e, '/api/admin/articles/' + id, 'PATCH', edit, true);
  assert.equal(
    (
      await request(
        e,
        '/api/ingest/checks/' + queued.id + '/result',
        'POST',
        grokResult(1),
      )
    ).response.status,
    409,
  );
  assert.equal(
    (await request(e, '/api/ingest/checks?status=pending')).data.requests
      .length,
    0,
  );
  assert.equal(
    e.DB.sql
      .prepare('SELECT state FROM article_checks WHERE id=?')
      .get(queued.id).state,
    'obsolete',
  );
  assert.match(
    e.DB.sql
      .prepare('SELECT ai_check_notes FROM articles WHERE id=?')
      .get(id).ai_check_notes,
    /編集者のメモ/,
  );
});
test('Grokには本文全文を渡し、素材の変更で再チェックを必要にする', async () => {
  const e = env(),
    id = await submitted(e);
  e.DB.sql
    .prepare('UPDATE articles SET body_markdown=? WHERE id=?')
    .run('保湿の情報。'.repeat(1000), id);
  const queued = await checkRequest(e, id);
  const list = (await request(e, '/api/ingest/checks')).data;
  assert.equal(list.requests[0].article.body_markdown.length, 6000);
  e.DB.sql
    .prepare("UPDATE sources SET raw_summary='新しい素材です'")
    .run();
  assert.equal(
    (
      await request(
        e,
        '/api/ingest/checks/' + queued.id + '/result',
        'POST',
        grokResult(1),
      )
    ).response.status,
    409,
  );
  assert.equal(
    (await request(e, '/api/ingest/checks')).data.requests.length,
    0,
  );
});
test('Grok依頼の登録はAI予算を使わず、内部モデルによる審査を実行しない', async () => {
  const e = env({ AI_DAILY_CALL_LIMIT: '0' }),
    id = await submitted(e);
  await checkRequest(e, id);
  assert.equal(
    (
      await request(
        e,
        '/api/admin/articles/' + id + '/ai-run',
        'POST',
        { revision: 1, kind: 'review' },
        true,
      )
    ).response.status,
    400,
  );
  assert.equal(
    e.DB.sql
      .prepare("SELECT COUNT(*) n FROM ai_jobs WHERE job_type='review'")
      .get().n,
    0,
  );
  assert.equal(
    e.DB.sql.prepare('SELECT COUNT(*) n FROM daily_budget').get().n,
    0,
  );
});
test('編集の各版を保存し、同じ古い版による上書きを拒否する', async () => {
  const e = env(),
    id = await submitted(e);
  const row = (
    await request(e, '/api/admin/articles/' + id, 'GET', null, true)
  ).data.article;
  const edit = {
    ...article('unused'),
    title: '変更したタイトル',
    revision: row.revision,
  };
  delete edit.slug;
  delete edit.source_ids;
  assert.equal(
    (await request(e, '/api/admin/articles/' + id, 'PATCH', edit, true))
      .response.status,
    200,
  );
  assert.equal(
    (await request(e, '/api/admin/articles/' + id, 'PATCH', edit, true))
      .response.status,
    409,
  );
  const old = (
    await request(
      e,
      '/api/admin/articles/' + id + '/versions/1',
      'GET',
      null,
      true,
    )
  ).data;
  assert.equal(old.version.title, row.title);
  assert.equal(
    e.DB.sql
      .prepare(
        'SELECT COUNT(*) n FROM article_versions WHERE article_id=?',
      )
      .get(id).n,
    2,
  );
});

test('失敗した要約の状態を更新し、AIチェック失敗では変えない', async () => {
  const e = env(),
    id = await submitted(e);
  invalidJson = true;
  try {
    await runJobs(e, { id, kind: 'enrich' });
  } finally {
    invalidJson = false;
  }
  assert.equal(
    e.DB.sql.prepare('SELECT ai_status FROM articles WHERE id=?').get(id)
      .ai_status,
    'failed',
  );
});

test('停止後の削除でメールを無効化し、利用中・管理者の削除は拒否する', async () => {
  const e = env();
  await request(
    e,
    '/api/admin/editors',
    'POST',
    { email: 'editor@example.test', active: true },
    true,
  );
  assert.equal(
    (
      await request(
        e,
        '/api/admin/editors',
        'DELETE',
        { email: 'editor@example.test' },
        true,
      )
    ).response.status,
    409,
  );
  assert.equal(
    (
      await request(
        e,
        '/api/admin/editors',
        'DELETE',
        { email: 'admin@example.test' },
        true,
      )
    ).response.status,
    400,
  );
  assert.equal(
    (
      await request(
        e,
        '/api/admin/editors',
        'DELETE',
        { email: 'editor@example.test' },
        'editor',
      )
    ).response.status,
    403,
  );
  await request(
    e,
    '/api/admin/editors',
    'POST',
    { email: 'editor@example.test', active: false },
    true,
  );
  assert.equal(
    (
      await request(
        e,
        '/api/admin/editors',
        'DELETE',
        { email: 'editor@example.test' },
        true,
      )
    ).response.status,
    200,
  );
  assert.equal(
    (await request(e, '/api/admin/me', 'GET', null, 'editor')).response
      .status,
    403,
  );
  assert.equal(
    e.DB.sql.prepare('SELECT COUNT(*) n FROM editors').get().n,
    0,
  );
  assert.equal(
    e.DB.sql
      .prepare(
        "SELECT COUNT(*) n FROM editor_events WHERE action='deleted'",
      )
      .get().n,
    1,
  );
});
test('海外の文章素材には生成モデルを呼ばず、タグだけ埋め込みで処理する', async () => {
  const e = env(),
    before = geminiCalls;
  const s = await request(e, '/api/ingest/sources', 'POST', {
    ...source,
    language: 'ko',
  });
  await runJobs(e);
  assert.equal(geminiCalls, before);
  const row = e.DB.sql
    .prepare('SELECT * FROM sources WHERE id=?')
    .get(s.data.id);
  assert.equal(row.raw_summary, source.raw_summary);
  assert.equal(row.summary_model, null);
  assert.equal(row.ai_status, 'complete');
});
test('類似記事は公開承認済みの最新埋め込みだけを最大5件返し、AIを再計算しない', async () => {
  const e = env(),
    id = await submitted(e);
  await processAll(e);
  const sourceId = e.DB.sql
    .prepare('SELECT id FROM sources LIMIT 1')
    .get().id;
  for (let n = 0; n < 7; n++) {
    const row = { ...article(sourceId), slug: 'related-' + n };
    const created = await request(e, '/api/ingest/articles', 'POST', row);
    await processAll(e);
    if (n < 6) {
      const rev = e.DB.sql
        .prepare('SELECT revision FROM articles WHERE id=?')
        .get(created.data.id).revision;
      await request(
        e,
        '/api/admin/articles/' + created.data.id + '/review',
        'POST',
        { status: 'published', revision: rev, confirmed: true },
        true,
      );
    }
  }
  const before = geminiCalls,
    result = await request(
      e,
      '/api/admin/articles/' + id + '/related',
      'GET',
      null,
      true,
    );
  assert.equal(result.data.articles.length, 5);
  assert.equal(
    result.data.articles.some((a) => a.slug === 'related-6'),
    false,
  );
  assert.equal(geminiCalls, before);
});

test('詳細検索と検索候補はAccess認証が必要で、編集者にも検索を許可する', async () => {
  const e = env();
  e.DB.sql
    .prepare(
      'INSERT INTO editors(email,added_by,updated_at) VALUES(?,?,?)',
    )
    .run(
      'editor@example.test',
      'admin@example.test',
      new Date().toISOString(),
    );
  const item = await submitted(e);
  for (const path of [
    '/api/admin/article-filters',
    '/api/admin/articles?q=保湿',
  ]) {
    assert.equal((await request(e, path)).response.status, 403);
    assert.equal(
      (await request(e, path, 'GET', null, 'editor')).response.status,
      200,
    );
  }
  const result = await request(
    e,
    '/api/admin/articles?q=保湿&category=skin',
    'GET',
    null,
    'editor',
  );
  assert.equal(result.data.total, 1);
  assert.equal(result.data.articles[0].id, item);
  const bad = await request(
    e,
    '/api/admin/articles?q=AND',
    'GET',
    null,
    true,
  );
  assert.equal(bad.response.status, 400);
  assert.match(bad.data.error.message, /検索語/);
});

async function releaseRequest(e, path, method = 'GET', body) {
  const response = await app.request(
    base + '/api/release/' + path,
    {
      method,
      headers: {
        Authorization: 'Bearer test-release-key',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    e,
  );
  return { response, data: await response.json() };
}
async function releaseFixture() {
  const e = env({
      RELEASE_API_KEY: 'test-release-key',
      CONTENT_DELIVERY_MODE: 'github',
    }),
    id = await submitted(e);
  await processAll(e);
  const row = e.DB.sql
    .prepare('SELECT * FROM articles WHERE id=?')
    .get(id);
  const approved = await request(
    e,
    '/api/admin/articles/' + id + '/review',
    'POST',
    { revision: row.revision, status: 'published', confirmed: true },
    true,
  );
  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.publication.state, 'waiting_github_sync');
  const file = (await releaseRequest(e, 'articles')).data.files[0];
  const body = {
    main_base_sha: 'a'.repeat(40),
    develop_sha: 'b'.repeat(40),
    changes: [
      {
        article_id: id,
        revision: file.revision,
        after_sha: file.sha,
        before_content: null,
      },
    ],
  };
  const started = await releaseRequest(e, 'requests', 'POST', body);
  assert.equal(started.response.status, 200);
  return { e, id, file, started: started.data, body };
}
function releasePass(f) {
  return {
    digest: f.started.digest,
    verdict: 'pass',
    checks: [
      {
        article_id: f.id,
        verdict: 'match',
        notes: '承認済みの本文・出典とGitの内容が一致しています。',
      },
    ],
    findings: [],
    summary: '相違はありません。',
  };
}
test('公開承認のない記事は同期せず、Botと同期キーの権限を分離する', async () => {
  const e = env({ RELEASE_API_KEY: 'test-release-key' });
  await submitted(e);
  assert.equal(
    (await releaseRequest(e, 'articles')).data.files.length,
    0,
  );
  assert.equal(
    (await request(e, '/api/release/articles')).response.status,
    401,
  );
  assert.equal(
    (await releaseRequest(e, '../admin/me')).response.status,
    403,
  );
  const f = await releaseFixture();
  assert.ok(!f.file.content.includes('ai_check_notes'));
  assert.equal(
    (
      await releaseRequest(
        f.e,
        'requests/' + f.started.id + '/published',
        'POST',
        {
          digest: f.started.digest,
          main_base_sha: f.body.main_base_sha,
          main_sha: 'c'.repeat(40),
        },
      )
    ).response.status,
    409,
  );
  const bot = await request(f.e, '/api/ingest/releases');
  assert.equal(bot.data.requests.length, 1);
  assert.equal(bot.data.requests[0].changes[0].content, f.file.content);
  assert.equal(bot.data.requests[0].changes[0].before_content, null);
  const mismatch = await releaseRequest(f.e, 'requests', 'POST', {
    ...f.body,
    changes: [{ ...f.body.changes[0], after_sha: '0'.repeat(64) }],
  });
  assert.equal(mismatch.response.status, 409);
  const again = await releaseRequest(f.e, 'requests', 'POST', f.body);
  assert.equal(again.data.id, f.started.id);
});
test('Grokの全記事の合格と最新digestがなければmain反映を承認しない', async () => {
  const f = await releaseFixture();
  let result = releasePass(f);
  const bad = await request(
    f.e,
    '/api/ingest/releases/' + f.started.id + '/result',
    'POST',
    { ...result, digest: '0'.repeat(64) },
  );
  assert.equal(bad.response.status, 409);
  result.findings = [
    {
      article_id: f.id,
      severity: 'warning',
      reason: '原文を確認できません。',
    },
  ];
  assert.equal(
    (
      await request(
        f.e,
        '/api/ingest/releases/' + f.started.id + '/result',
        'POST',
        result,
      )
    ).response.status,
    400,
  );
  result = releasePass(f);
  const pass = await request(
    f.e,
    '/api/ingest/releases/' + f.started.id + '/result',
    'POST',
    result,
  );
  assert.equal(pass.data.state, 'approved');
  assert.equal(
    (
      await request(
        f.e,
        '/api/ingest/releases/' + f.started.id + '/result',
        'POST',
        result,
      )
    ).data.cached,
    true,
  );
  const final = {
    digest: f.started.digest,
    main_base_sha: f.body.main_base_sha,
    main_sha: 'c'.repeat(40),
  };
  assert.equal(
    (
      await request(
        f.e,
        '/api/release/requests/' + f.started.id + '/published',
        'POST',
        final,
      )
    ).response.status,
    401,
  );
  assert.equal(
    (
      await releaseRequest(
        f.e,
        'requests/' + f.started.id + '/published',
        'POST',
        final,
      )
    ).data.state,
    'released',
  );
  assert.equal(
    (await releaseRequest(f.e, 'builds')).data.releases.length,
    1,
  );
  assert.equal(
    (
      await releaseRequest(
        f.e,
        'requests/' + f.started.id + '/build',
        'POST',
        {
          main_sha: final.main_sha,
          build_id: 'd291053c-b95b-4448-ba8a-d622e7d4b7f8',
        },
      )
    ).data.state,
    'building',
  );
  assert.equal(
    (await releaseRequest(f.e, 'builds')).data.releases.length,
    0,
  );
  assert.equal(
    f.e.DB.sql.prepare('SELECT status FROM articles WHERE id=?').get(f.id)
      .status,
    'published',
  );
});
test('相違・不明の結果は停止し、後から素材が変わった合格結果も無効化する', async () => {
  const f = await releaseFixture(),
    blocked = {
      ...releasePass(f),
      verdict: 'block',
      checks: [
        {
          article_id: f.id,
          verdict: 'uncertain',
          notes: '原文を確認できません。',
        },
      ],
    };
  assert.equal(
    (
      await request(
        f.e,
        '/api/ingest/releases/' + f.started.id + '/result',
        'POST',
        blocked,
      )
    ).data.state,
    'rejected',
  );
  assert.equal(
    (
      await releaseRequest(
        f.e,
        'requests/' + f.started.id + '/published',
        'POST',
        {
          digest: f.started.digest,
          main_base_sha: f.body.main_base_sha,
          main_sha: 'c'.repeat(40),
        },
      )
    ).response.status,
    409,
  );
  const fresh = await releaseFixture();
  await request(
    fresh.e,
    '/api/ingest/releases/' + fresh.started.id + '/result',
    'POST',
    releasePass(fresh),
  );
  fresh.e.DB.sql
    .prepare("UPDATE sources SET raw_summary='内容が変わりました。'")
    .run();
  assert.equal(
    (await releaseRequest(fresh.e, 'requests/' + fresh.started.id))
      .response.status,
    409,
  );
  assert.equal(
    fresh.e.DB.sql
      .prepare('SELECT state FROM content_releases WHERE id=?')
      .get(fresh.started.id).state,
    'superseded',
  );
});
test('公開記事の改訂は人の操作だけで作り、再承認前の版を同期APIへ出さない', async () => {
  const f = await releaseFixture();
  assert.equal(
    (
      await request(
        f.e,
        '/api/admin/articles/' + f.id + '/revise',
        'POST',
        { revision: f.file.revision },
      )
    ).response.status,
    403,
  );
  const result = await request(
    f.e,
    '/api/admin/articles/' + f.id + '/revise',
    'POST',
    { revision: f.file.revision },
    true,
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.data.status, 'pending_review');
  assert.equal(result.data.revision, f.file.revision + 1);
  assert.equal(
    (await releaseRequest(f.e, 'articles')).data.files.length,
    0,
  );
  assert.equal(
    (
      await request(
        f.e,
        '/api/admin/articles/' + f.id + '/revise',
        'POST',
        { revision: f.file.revision },
        true,
      )
    ).response.status,
    409,
  );
  assert.equal(
    (
      await request(
        f.e,
        '/api/ingest/releases/' + f.started.id + '/result',
        'POST',
        releasePass(f),
      )
    ).response.status,
    409,
  );
  assert.ok(
    f.e.DB.sql
      .prepare(
        'SELECT body_markdown FROM article_versions WHERE article_id=? AND revision=?',
      )
      .get(f.id, f.file.revision),
  );
});

const feedbackOrigin = "https://develop-beauty-app.sinyak4649.workers.dev";
const feedbackEnv = () =>
  env({ TURNSTILE_SECRET_KEY: "unit-secret", TURNSTILE_SITE_KEY: "unit-site" });
const submission = () => ({
  id: crypto.randomUUID(),
  message: "もっと髪の成分を紹介してほしいです。",
  token: "valid",
});
const sendFeedback = (e, body, origin = feedbackOrigin, ip = "192.0.2.1") =>
  app.request(
    base + "/api/feedback",
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
      },
      body: JSON.stringify(body),
    },
    e,
  );
test("意見箱は任意の名前・メールを許可し、Turnstile成功時だけ保存する", async () => {
  const e = feedbackEnv(),
    body = submission();
  let r = await sendFeedback(e, body);
  assert.equal(r.status, 201);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), feedbackOrigin);
  const row = e.DB.sql.prepare("SELECT * FROM feedback").get();
  assert.equal(row.name, null);
  assert.equal(row.email, null);
  assert.equal(row.message, body.message);
  r = await sendFeedback(e, body);
  assert.equal(r.status, 201);
  assert.equal(e.DB.sql.prepare("SELECT count(*) n FROM feedback").get().n, 1);
  r = await sendFeedback(e, { ...body, message: "変更された本文" });
  assert.equal(r.status, 409);
});
test("意見箱は不正な確認・別ホスト・不正入力・許可外Originを保存しない", async () => {
  for (const body of [
    { ...submission(), token: "invalid" },
    { ...submission(), token: "wrong-host" },
    { ...submission(), token: "wrong-action" },
    { ...submission(), message: "  " },
    { ...submission(), email: "not-email" },
    { ...submission(), company_website: "bot" },
    { ...submission(), message: "a".repeat(5001) },
  ]) {
    const e = feedbackEnv();
    assert.equal((await sendFeedback(e, body)).status, 400);
    assert.equal(
      e.DB.sql.prepare("SELECT count(*) n FROM feedback").get().n,
      0,
    );
  }
  const e = feedbackEnv();
  const r = await sendFeedback(e, submission(), "https://evil.example");
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await sendFeedback(env(), submission())).status, 503);
  const options = await app.request(
    base + "/api/feedback",
    { method: "OPTIONS", headers: { Origin: feedbackOrigin } },
    e,
  );
  assert.equal(options.status, 204);
  assert.equal(
    options.headers.get("Access-Control-Allow-Origin"),
    feedbackOrigin,
  );
  const config = await app.request(base + "/api/feedback/config", {}, e);
  const text = await config.text();
  assert.ok(!text.includes("unit-secret"));
  assert.equal(JSON.parse(text).enabled, true);
});
test("意見箱の回数制限は共有DBで制御し、IPを平文保存しない", async () => {
  const e = feedbackEnv();
  for (let i = 0; i < 3; i++)
    assert.equal((await sendFeedback(e, submission())).status, 201);
  assert.equal((await sendFeedback(e, submission())).status, 429);
  const rows = e.DB.sql.prepare("SELECT bucket FROM rate_limits").all();
  assert.ok(rows.every((row) => !row.bucket.includes("192.0.2.1")));
  assert.equal(
    (await sendFeedback(e, submission(), feedbackOrigin, "192.0.2.2")).status,
    201,
  );
});
test("投稿の個人情報は管理者だけが確認・変更・削除できる", async () => {
  const e = feedbackEnv(),
    body = { ...submission(), name: "投稿者", email: "reader@example.test" };
  await sendFeedback(e, body);
  e.DB.sql
    .prepare(
      "INSERT INTO editors(email,active,updated_at,added_by) VALUES(?,1,?,?)",
    )
    .run("editor@example.test", new Date().toISOString(), "admin@example.test");
  for (const auth of [false, "editor"])
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const result = await request(
        e,
        "/api/admin/feedback" + (method === "GET" ? "" : "/" + body.id),
        method,
        method === "PATCH" ? { status: "read" } : undefined,
        auth,
      );
      assert.equal(result.response.status, 403);
    }
  const list = await request(e, "/api/admin/feedback", "GET", undefined, true);
  assert.equal(list.data.items[0].email, body.email);
  assert.equal(list.data.unread, 1);
  const mark = await request(
    e,
    "/api/admin/feedback/" + body.id,
    "PATCH",
    { status: "read" },
    true,
  );
  assert.equal(mark.response.status, 200);
  assert.equal(
    e.DB.sql.prepare("SELECT reviewed_by FROM feedback").get().reviewed_by,
    "admin@example.test",
  );
  const deletion = await request(
    e,
    "/api/admin/feedback/" + body.id,
    "DELETE",
    undefined,
    true,
  );
  assert.equal(deletion.response.status, 200);
  assert.equal(e.DB.sql.prepare("SELECT count(*) n FROM feedback").get().n, 0);
});

test("Turnstile停止時と大きすぎるリクエストを保存せず拒否する", async () => {
  const e = feedbackEnv();
  assert.equal(
    (await sendFeedback(e, { ...submission(), token: "unavailable" })).status,
    503,
  );
  const huge = await sendFeedback(e, {
    ...submission(),
    message: "a".repeat(22000),
  });
  assert.equal(huge.status, 413);
  assert.equal(e.DB.sql.prepare("SELECT count(*) n FROM feedback").get().n, 0);
});

test('意見箱APIは状態ごとの全件数と指定表示数・ページを返す',async()=>{
 const e=feedbackEnv();for(let i=0;i<59;i++)e.DB.sql.prepare('INSERT INTO feedback(id,message,payload_hash,status,created_at) VALUES(?,?,?,?,?)').run(String(i).padStart(3,'0'),'本文'+i,'hash-'+i,i%2?'read':'new','2026-10-13T00:00:00Z');
 const first=await request(e,'/api/admin/feedback?status=all&limit=20&offset=0','GET',undefined,true);
 const last=await request(e,'/api/admin/feedback?status=all&limit=20&offset=40','GET',undefined,true);
 assert.equal(first.data.total,59);assert.equal(first.data.items.length,20);assert.equal(last.data.items.length,19);assert.ok(last.data.items.every(row=>!first.data.items.some(item=>item.id===row.id)));
 const filtered=await request(e,'/api/admin/feedback?status=new&limit=10&offset=10','GET',undefined,true);assert.equal(filtered.data.total,30);assert.equal(filtered.data.unread,30);assert.equal(filtered.data.items.length,10);assert.ok(filtered.data.items.every(row=>row.status==='new'));
 assert.equal((await request(e,'/api/admin/feedback?limit=51','GET',undefined,true)).response.status,400);
});

test('非公開は管理者・編集者の理由付き承認が必要で、初期記事も管理できる',async()=>{
 const e=env({RELEASE_API_KEY:'test-release-key'});e.DB.sql.prepare('INSERT INTO editors(email,active,updated_at,added_by) VALUES(?,1,?,?)').run('editor@example.test',new Date().toISOString(),'admin@example.test');
 const found=await request(e,'/api/admin/publications','GET',undefined,'editor');assert.equal(found.response.status,200);const entry=found.data.items.find(row=>row.slug==='moisturizer-basics');assert.ok(entry);assert.equal(entry.origin,'initial');
 const body={slug:entry.slug,revision_token:entry.revision_token,reason:'内容を再確認するため',confirmed:true};
 assert.equal((await request(e,'/api/admin/publications/withdraw','POST',body)).response.status,403);
 assert.equal((await request(e,'/api/admin/publications/withdraw','POST',{...body,reason:' '},true)).response.status,400);
 assert.equal((await request(e,'/api/admin/publications/withdraw','POST',{...body,confirmed:false},true)).response.status,400);
 assert.equal((await request(e,'/api/admin/publications/withdraw','POST',{...body,revision_token:'stale'},true)).response.status,409);
 const result=await request(e,'/api/admin/publications/withdraw','POST',body,'editor');assert.equal(result.response.status,201);const again=await request(e,'/api/admin/publications/withdraw','POST',body,'editor');assert.equal(result.data.id,again.data.id);
 const record=e.DB.sql.prepare('SELECT * FROM article_withdrawals').get();assert.equal(record.actor,'editor@example.test');assert.equal(record.reason,body.reason);
 const manifest=await releaseRequest(e,'withdrawals');assert.deepEqual(manifest.data.withdrawals,[{id:result.data.id,slug:entry.slug}]);assert.ok(!JSON.stringify(manifest.data).includes('editor@example.test'));assert.ok(!JSON.stringify(manifest.data).includes(body.reason));
 const built=await releaseRequest(e,'withdrawals/build','POST',{withdrawals:manifest.data.withdrawals,main_sha:'a'.repeat(40),build_id:crypto.randomUUID()});assert.equal(built.response.status,200);assert.equal(e.DB.sql.prepare('SELECT state FROM article_withdrawals').get().state,'building');
 assert.throws(()=>e.DB.sql.prepare('DELETE FROM article_withdrawals').run(),/preserved/);
});
test('非公開依頼後は本文を残し、公開同期とGrokの古い本番反映を停止する',async()=>{
 const f=await releaseFixture();const list=await request(f.e,'/api/admin/publications','GET',undefined,true);const item=list.data.items.find(row=>row.article_id===f.id);assert.ok(item);
 const before=f.e.DB.sql.prepare('SELECT body_markdown FROM articles WHERE id=?').get(f.id).body_markdown;
 const result=await request(f.e,'/api/admin/publications/withdraw','POST',{slug:item.slug,revision_token:item.revision_token,reason:'出典の再確認',confirmed:true},true);assert.equal(result.response.status,201);
 assert.equal(f.e.DB.sql.prepare('SELECT body_markdown FROM articles WHERE id=?').get(f.id).body_markdown,before);
 assert.equal((await releaseRequest(f.e,'articles')).data.files.length,0);
 const old=await releaseRequest(f.e,'requests/'+f.started.id);assert.equal(old.response.status,409);
 const re=await request(f.e,'/api/admin/articles/'+f.id+'/revise','POST',{revision:f.file.revision},true);assert.equal(re.response.status,200);await processAll(f.e);const revision=f.e.DB.sql.prepare('SELECT revision FROM articles WHERE id=?').get(f.id).revision;
 const approved=await request(f.e,'/api/admin/articles/'+f.id+'/review','POST',{revision,status:'published',confirmed:true},true);assert.equal(approved.response.status,409);assert.equal(approved.data.error.code,'article_withdrawn');
});

 test('請求・Cursor CSV APIは管理者だけに許可し、Originと置き換え確認を検証する', async () => {
  const e = env();
  for (const path of ['/api/admin/billing','/api/admin/billing/cursor','/api/admin/billing/sync']) {
    const options = { method: path.endsWith('/billing') ? 'GET' : 'POST', headers: { 'Cf-Access-Jwt-Assertion': editorToken, Origin: base, 'Content-Type': 'application/json' }, body: path.endsWith('/billing') ? undefined : '{}' };
    assert.equal((await app.request(base+path, options, e)).status,403);
  }
  assert.equal((await app.request(base+'/api/admin/billing',{},e)).status,403);
  const headers = { 'Cf-Access-Jwt-Assertion': token, Origin: base, 'Content-Type': 'application/json' };
  assert.equal((await app.request(base+'/api/admin/billing?month=2026-13',{headers},e)).status,400);
  const body = { csv:'Date,Type,Cost\n2026-10-01T00:00:00Z,Included,0.10', replace_confirmed:true };
  assert.equal((await app.request(base+'/api/admin/billing/cursor',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:JSON.stringify(body)},e)).status,403);
  assert.equal((await app.request(base+'/api/admin/billing/cursor',{method:'POST',headers,body:JSON.stringify({...body,replace_confirmed:false})},e)).status,400);
  assert.equal((await app.request(base+'/api/admin/billing/cursor',{method:'POST',headers,body:JSON.stringify(body)},e)).status,200);
  const data=await (await app.request(base+'/api/admin/billing?month=2026-10',{headers},e)).json();
  assert.equal(data.cursor.groups[0].cost_usd,.1); assert.equal(data.cursor.remaining,null);
});
