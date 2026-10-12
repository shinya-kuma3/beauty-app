import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { adminPage } from '../worker/admin.mjs';
const script = await readFile(
  new URL('../public/admin-dashboard.js', import.meta.url),
  'utf8',
);
const row = {
  id: 'test-article',
  title: '保湿のケア',
  category: 'skin',
  status: 'pending_review',
  ai_status: 'complete',
  revision: 2,
  updated_at: '2026-10-12T00:00:00Z',
  body_markdown: '保存済みの本文です。',
  excerpt: '紹介文',
  tags: [],
  citations: ['https://example.org/paper'],
  ai_check_notes: '原文を確認してください。',
  summary: '保湿を考える内容',
  key_points: ['状態を見る'],
  ai_tags: ['スキンケア'],
};
async function settle() {
  for (let i = 0; i < 10; i++)
    await new Promise((resolve) => setImmediate(resolve));
}
async function setup(role = 'editor') {
  const window = new Window({
    url: 'https://example.test/admin',
    settings: {
      enableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  window.document.write(adminPage());
  const calls = [];
  let conflict = false,
    block = null;
  window.confirm = () => true;
  window.fetch = async (url, options = {}) => {
    const path = String(url).replace('/api/admin/', '');
    calls.push({
      path,
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : null,
    });
    if (block) await block;
    if (path === 'me')
      return Response.json({ email: 'editor@example.test', role });
    if (path.startsWith('articles?'))
      return Response.json({ articles: [row], next_offset: null });
    if (
      path === 'articles/test-article' &&
      (options.method || 'GET') === 'GET'
    )
      return Response.json({
        article: row,
        preview_html: '<p>保存済みの本文です。</p>',
        sources: [],
        events: [
          {
            actor: 'writer@example.test',
            action: 'edited',
            revision: 2,
            created_at: row.updated_at,
          },
        ],
        versions: [],
        publication: null,
        review_flags: ['原文を確認してください。'],
        check: null,
      });
    if (path === 'preview')
      return Response.json({ preview_html: '<p>未保存の本文</p>' });
    if (path === 'operations')
      return Response.json({
        settings: { dailyCalls: 30, dailyTokens: 600000 },
        jobs: [],
        channels: [],
        usage: null,
      });
    if (path === 'editors')
      return Response.json({
        editors: [],
        admins: ['admin@example.test'],
      });
    if (options.method === 'PATCH' && conflict)
      return Response.json(
        { error: { code: 'revision_conflict' } },
        { status: 409 },
      );
    if (path.endsWith('ai-check'))
      return Response.json({ state: 'queued' });
    if (path.endsWith('ai-run'))
      return Response.json({ jobs: [{ state: 'complete' }] });
    return Response.json({});
  };
  window.eval(script);
  await settle();
  return {
    window,
    calls,
    setConflict: (v) => (conflict = v),
    setBlock: (v) => (block = v),
    $: (id) => window.document.getElementById(id),
  };
}
test('編集者は個別記事の編集・確認・AIチェックを使い、管理機能を表示しない', async () => {
  const s = await setup();
  try {
    assert.equal(s.$('team-tools').hidden, true);
    assert.equal(
      s.calls.some((c) => c.path === 'operations'),
      false,
    );
    s.$('articles').querySelector('button').click();
    await settle();
    assert.equal(s.$('detail').hidden, false);
    s.$('tab-ai').click();
    await settle();
    assert.equal(s.$('panel-ai').hidden, false);
    s.$('ai-check').click();
    await settle();
    assert.ok(
      s.calls.some(
        (c) =>
          c.path === 'articles/test-article/ai-check' &&
          c.body.revision === 2,
      ),
    );
    assert.ok(
      s.calls.some(
        (c) =>
          c.path === 'articles/test-article/ai-run' &&
          c.body.kind === 'review',
      ),
    );
    assert.equal(
      s.calls.some((c) => c.path.endsWith('/review')),
      false,
    );
    assert.match(s.$('history').textContent, /writer@example.test/);
  } finally {
    await s.window.happyDOM.close();
  }
});
test('未保存の本文を確認でき、競合で入力を失わず、未保存なら公開できない', async () => {
  const s = await setup();
  try {
    s.$('articles').querySelector('button').click();
    await settle();
    const body = s.$('editor').elements.body_markdown;
    body.value = '未保存の本文';
    body.dispatchEvent(new s.window.Event('input'));
    s.$('confirm').checked = true;
    s.$('confirm').dispatchEvent(new s.window.Event('change'));
    assert.equal(s.$('publish').disabled, true);
    assert.equal(s.$('ai-check').disabled, true);
    s.$('tab-preview').click();
    await settle();
    assert.match(s.$('preview').textContent, /未保存/);
    assert.equal(
      s.calls.some((c) => c.method === 'PATCH'),
      false,
    );
    s.$('tab-edit').click();
    s.setConflict(true);
    s.$('editor').dispatchEvent(
      new s.window.Event('submit', { cancelable: true }),
    );
    await settle();
    assert.equal(body.value, '未保存の本文');
    assert.match(s.$('message').textContent, /入力内容は残しています/);
    s.window.confirm = () => false;
    s.$('status').value = 'published';
    s.$('status').dispatchEvent(new s.window.Event('change'));
    assert.equal(s.$('status').value, 'pending_review');
    assert.equal(body.value, '未保存の本文');
  } finally {
    await s.window.happyDOM.close();
  }
});
test('管理者に編集者管理を表示し、処理中は本文を変更させない', async () => {
  const s = await setup('admin');
  try {
    assert.equal(s.$('team-tools').hidden, false);
    assert.ok(s.calls.some((c) => c.path === 'editors'));
    s.$('articles').querySelector('button').click();
    await settle();
    let release;
    const wait = new Promise((r) => (release = r));
    s.setBlock(wait);
    s.$('ai-check').click();
    assert.equal(s.$('editor').elements.body_markdown.disabled, true);
    s.setBlock(null);
    release();
    await settle();
    assert.equal(s.$('editor').elements.body_markdown.disabled, false);
  } finally {
    await s.window.happyDOM.close();
  }
});
