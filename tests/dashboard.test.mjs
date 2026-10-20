import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { adminPage } from '../worker/admin.mjs';
const script = await readFile(
  new URL('../public/admin-dashboard.js', import.meta.url),
  'utf8',
);
const pickerScript = await readFile(
  new URL('../public/tag-picker.js', import.meta.url),
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
async function setup(role = 'editor', members = [], articles = [row]) {
  const checks = new Map();
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
    if (path === 'article-filters')
      return Response.json({
        tags: ['スキンケア', '乾燥肌'],
        dates: {
          first_created: '2019-01-01T00:00:00.000Z',
          last_created: '2026-10-12T00:00:00.000Z',
        },
      });
    if (path.startsWith('articles?'))
      return Response.json({
        articles,
        next_cursor: null,
        total: 1,
      });
    const selected = articles.find(article => path === 'articles/' + article.id);
    if (selected && (options.method || 'GET') === 'GET')
      return Response.json({
        article: selected,
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
        check: checks.get(selected.id) || null,
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
        editors: members,
        admins: ['admin@example.test'],
      });
    if (options.method === 'PATCH' && conflict)
      return Response.json(
        { error: { code: 'revision_conflict' } },
        { status: 409 },
      );
    if (path.endsWith('ai-check')) {
      const id=path.split('/')[1];checks.set(id,{id:'check-'+id,state:'pending',revision:2,stale:false,requested_by:'editor@example.test',created_at:row.updated_at,result:null});
      return Response.json({ id:'check-'+id,state: 'pending' });
    }
    if (path.endsWith('ai-run'))
      return Response.json({ jobs: [{ state: 'complete' }] });
    return Response.json({});
  };
  window.eval(pickerScript);
  window.eval(script);
  await settle();
  return {
    window,
    calls,
    setCheck: (id,check) => checks.set(id,check),
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
    assert.equal(
      s.calls.some((c) => c.path === 'articles/test-article/ai-run'),
      false,
    );
    assert.match(s.$('message').textContent, /Grok Botへの依頼/);
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

test('停止した編集者だけに削除を表示し、確認後に削除APIを呼ぶ', async () => {
  const s = await setup('admin', [
    { email: 'inactive@example.test', active: false },
    { email: 'active@example.test', active: true },
  ]);
  try {
    const rows = [...s.$('members').querySelectorAll('.member-row')];
    assert.equal(rows[0].classList.contains('inactive'), true);
    assert.equal(rows[0].querySelectorAll('button').length, 2);
    assert.equal(rows[1].querySelectorAll('button').length, 1);
    assert.equal(
      rows[0].querySelector('.member-status.inactive').textContent,
      '停止中',
    );
    assert.equal(
      rows[1].querySelector('.member-status.active').textContent,
      '利用中',
    );
    assert.equal(
      rows[0].querySelector('.member-actions').firstChild.textContent,
      '削除',
    );
    assert.equal(
      rows[0].querySelector('.member-actions').lastChild.textContent,
      '利用を再開',
    );
    rows[0].querySelector('button.danger').click();
    await settle();
    assert.ok(
      s.calls.some(
        (c) =>
          c.path === 'editors' &&
          c.method === 'DELETE' &&
          c.body.email === 'inactive@example.test',
      ),
    );
  } finally {
    await s.window.happyDOM.close();
  }
});

test('詳細検索をサーバーへ送り、検索しても編集中の本文を残す', async () => {
  const s = await setup();
  try {
    s.$('articles').querySelector('button').click();
    await settle();
    const body = s.$('editor').elements.body_markdown;
    body.value = '編集中';
    body.dispatchEvent(new s.window.Event('input'));
    s.$('article-search').value = '保湿 セラミド';
    s.$('keyword-mode').value = 'any';
    s.$('exclude-keywords').value = '香料';
    const picker = s.$('admin-tags');
    picker.querySelector('[data-tag-open]').click();
    for (const checkbox of picker.querySelectorAll(
      '[data-tag-choices] input',
    )) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new s.window.Event('change'));
    }
    picker.querySelector('[data-tag-apply]').click();
    s.$('tag-mode').value = 'or';
    s.$('search-month').value = '2026-10';
    s.$('date-basis').value = 'updated';
    s.$('article-filters').querySelector('input[value="skin"]').checked =
      true;
    s.$('article-filters').dispatchEvent(
      new s.window.Event('submit', { cancelable: true }),
    );
    await settle();
    const call = s.calls
        .filter((c) => c.path.startsWith('articles?'))
        .at(-1),
      params = new URLSearchParams(call.path.split('?')[1]);
    assert.equal(params.get('q'), '保湿 セラミド');
    assert.equal(params.get('keyword_mode'), 'any');
    assert.equal(params.get('exclude'), '香料');
    assert.deepEqual(
      params.getAll('tag').sort(),
      ['スキンケア', '乾燥肌'].sort(),
    );
    assert.equal(params.get('tag_mode'), 'or');
    assert.equal(params.get('month'), '2026-10');
    assert.equal(params.get('date_basis'), 'updated');
    assert.deepEqual(params.getAll('category'), ['skin']);
    assert.equal(body.value, '編集中');
    assert.equal(s.$('save-state').textContent, '未保存の変更あり');
    assert.equal(s.$('article-count').textContent, '1件中 1件表示');
    assert.equal(
      picker.querySelectorAll('[data-tag-choices] input').length,
      2,
    );
    assert.equal(s.$('search-decade'), null);
    assert.equal(s.$('search-year'), null);
    assert.deepEqual(
      [...s.$('tag-mode').options].map((o) => o.value),
      ['or', 'and'],
    );
    assert.doesNotMatch(
      s.$('article-filters').textContent,
      /\b(?:AND|OR|NOT)\b/,
    );
    s.$('reset-search').click();
    await settle();
    const reset = new URLSearchParams(
      s.calls
        .filter((c) => c.path.startsWith('articles?'))
        .at(-1)
        .path.split('?')[1],
    );
    assert.equal(reset.has('q'), false);
    assert.equal(reset.has('month'), false);
    assert.equal(reset.has('tag'), false);
    assert.equal(
      picker.querySelector('[data-tag-selected]').textContent,
      '指定なし',
    );
    assert.equal(reset.get('status'), 'pending_review');
    assert.equal(body.value, '編集中');
  } finally {
    await s.window.happyDOM.close();
  }
});

test('続きを表示するとき未適用のフォーム変更を混ぜず、APIの検索エラーを表示する', async () => {
  const s = await setup();
  try {
    const original = s.window.fetch;
    s.window.fetch = async (url, options) => {
      const params = new URLSearchParams(String(url).split('?')[1]);
      if (String(url).startsWith('/api/admin/articles?')) {
        await original(url, options);
        if (params.get('q') === 'invalid')
          return Response.json(
            {
              error: {
                code: 'invalid_search_query',
                message: '閉じかっこが足りません。',
              },
            },
            { status: 400 },
          );
        return Response.json({
          articles: [row],
          total: 2,
          next_cursor: params.has('cursor') ? null : 'test-cursor',
        });
      }
      return original(url, options);
    };
    s.$('article-search').value = '保湿';
    s.$('article-filters').dispatchEvent(
      new s.window.Event('submit', { cancelable: true }),
    );
    await settle();
    assert.equal(s.$('more').hidden, false);
    s.$('article-search').value = '未適用';
    s.$('more').click();
    await settle();
    let params = new URLSearchParams(
      s.calls
        .filter((c) => c.path.startsWith('articles?'))
        .at(-1)
        .path.split('?')[1],
    );
    assert.equal(params.get('q'), '保湿');
    assert.equal(params.get('cursor'), 'test-cursor');
    assert.equal(s.$('article-count').textContent, '2件中 2件表示');
    assert.equal(s.$('more').hidden, true);
    s.$('article-search').value = 'invalid';
    s.$('article-filters').dispatchEvent(
      new s.window.Event('submit', { cancelable: true }),
    );
    await settle();
    assert.match(s.$('message').textContent, /閉じかっこが足りません/);
    assert.equal(s.$('articles').querySelectorAll('button').length, 2);
  } finally {
    await s.window.happyDOM.close();
  }
});

test('記事一覧を更新しても意見箱の前へ・次への無効状態を解除しない',async()=>{
 const s=await setup('admin');try{s.window.eval(await readFile(new URL('../public/admin-feedback.js',import.meta.url),'utf8'));await settle();assert.equal(s.$('feedback-prev').disabled,true);assert.equal(s.$('feedback-next').disabled,true);s.$('refresh').click();await settle();assert.equal(s.$('feedback-prev').disabled,true);assert.equal(s.$('feedback-next').disabled,true);}finally{await s.window.happyDOM.close();}
});


test('再チェックは選択した1記事だけを依頼し、その記事だけ緑表示・専用依頼文にする',async()=>{
 const second={...row,id:'second-article',title:'ヘアケアの記事'};
 const s=await setup('editor',[],[row,second]);
 try {
  const buttons=()=>[...s.$('articles').querySelectorAll('.article-item')];
  buttons()[1].click();await settle();s.$('ai-check').click();await settle();
  assert.deepEqual(s.calls.filter(call=>call.path.endsWith('/ai-check')).map(call=>call.path),['articles/second-article/ai-check']);
  assert.equal(buttons()[0].classList.contains('rechecking'),false);assert.equal(buttons()[1].classList.contains('rechecking'),true);assert.match(buttons()[1].textContent,/Grok再チェック中/);
  const instruction=s.$('check-result').querySelector('pre').textContent;assert.match(instruction,/checks\/check-second-article/);assert.match(instruction,/この記事だけ/);assert.doesNotMatch(instruction,/test-article|limit=5/);
  s.setCheck(second.id,{id:'check-second-article',state:'complete',revision:2,stale:false,requested_by:'editor@example.test',created_at:row.updated_at,result:null});
  buttons()[1].click();await settle();assert.equal(buttons()[1].classList.contains('rechecking'),false);assert.equal(buttons()[1].querySelector('.recheck-status'),null);
 }finally{await s.window.happyDOM.close();}
});
test('一覧の再取得でも依頼中の色を復元し、古い版や完了の状態を緑にしない',async()=>{
 const s=await setup('editor',[],[{...row,recheck_pending:1},{...row,id:'other',recheck_pending:0}]);
 try {const items=[...s.$('articles').querySelectorAll('.article-item')];assert.equal(items[0].classList.contains('rechecking'),true);assert.equal(items[1].classList.contains('rechecking'),false);s.setCheck(row.id,{state:'pending',stale:true});items[0].click();await settle();assert.equal(items[0].classList.contains('rechecking'),false);}finally{await s.window.happyDOM.close();}
});
