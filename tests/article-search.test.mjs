import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  articleList,
  filterOptions,
  parseExpression,
  searchPlan,
} from '../worker/article-search.mjs';
function database() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(
    new URL('../migrations/', import.meta.url),
  )
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sql.exec(
      readFileSync(
        new URL('../migrations/' + file, import.meta.url),
        'utf8',
      ),
    );
  return {
    sql,
    DB: {
      prepare(query) {
        return {
          params: [],
          bind(...params) {
            this.params = params;
            return this;
          },
          async all() {
            return { results: sql.prepare(query).all(...this.params) };
          },
          async first() {
            return sql.prepare(query).get(...this.params) ?? null;
          },
        };
      },
    },
  };
}
function insert(
  db,
  id,
  {
    title = '保湿ケア',
    body = 'セラミドについて',
    excerpt = '素材を確認',
    category = 'skin',
    tags = ['スキンケア'],
    notes = '根拠を確認',
    created = '2026-10-01T00:00:00.000Z',
    updated = created,
    status = 'pending_review',
    published = null,
  } = {},
) {
  db.sql
    .prepare(
      'INSERT INTO articles(id,slug,title,body_markdown,excerpt,category,tags,citations,ai_check_notes,created_at,updated_at,content_hash,ai_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      'slug-' + id,
      title,
      body,
      excerpt,
      category,
      JSON.stringify(tags),
      '[]',
      notes,
      created,
      updated,
      'hash-' + id,
      'complete',
    );
  if (status !== 'draft')
    db.sql
      .prepare("UPDATE articles SET status='pending_review' WHERE id=?")
      .run(id);
  if (status === 'published')
    db.sql
      .prepare(
        "UPDATE articles SET status='published',published_at=?,reviewed_by='tester' WHERE id=?",
      )
      .run(published || created, id);
  if (status === 'rejected')
    db.sql
      .prepare("UPDATE articles SET status='rejected' WHERE id=?")
      .run(id);
}
const search = (db, query = {}) =>
  articleList(db, new URLSearchParams(query));
const ids = (result) => result.articles.map((r) => r.id).sort();
test('全文検索は50件の取得制限より前に行い、AND／OR／NOT・括弧・語句を処理する', async () => {
  const db = database();
  try {
    insert(db, 'a', { title: '保湿の情報', body: 'ceramideについて' });
    insert(db, 'b', { title: '保湿と香料', body: '香料のこと' });
    insert(db, 'c', { title: '髪の情報', body: 'セラミド' });
    insert(db, 'd', { title: '保湿ではない', status: 'draft' });
    assert.deepEqual(
      ids(await search(db, { q: '(保湿 OR セラミド) AND NOT 香料' })),
      ['a', 'c'],
    );
    assert.deepEqual(ids(await search(db, { q: '保湿 香料' })), ['b']);
    assert.deepEqual(ids(await search(db, { q: 'NOT 香料' })), [
      'a',
      'c',
    ]);
    assert.deepEqual(
      ids(await search(db, { q: '保湿 OR セラミド AND NOT 香料' })),
      ['a', 'b', 'c'],
    );
    assert.deepEqual(ids(await search(db, { q: '"保湿の情報"' })), ['a']);
    assert.deepEqual(
      ids(await search(db, { q: 'CERAMIDE', scope: 'body' })),
      ['a'],
    );
    assert.deepEqual(
      ids(await search(db, { q: 'セラミド', scope: 'title' })),
      [],
    );
    for (let i = 0; i < 60; i++)
      insert(db, 'later-' + i, {
        title: '新しい記事',
        body: '洗髪',
        created: '2026-10-02T00:00:00.000Z',
      });
    assert.deepEqual(ids(await search(db, { q: 'ceramide' })), ['a']);
    assert.deepEqual(
      ids(
        await search(db, { q: '根拠', scope: 'notes', category: 'skin' }),
      ).length,
      50,
    );
    const plan = db.sql
      .prepare(
        "EXPLAIN QUERY PLAN SELECT rowid FROM article_search WHERE title LIKE '%保湿の情報%'",
      )
      .all();
    assert.ok(
      plan.some((row) => /VIRTUAL TABLE INDEX.*L/.test(row.detail)),
      JSON.stringify(plan),
    );
  } finally {
    db.sql.close();
  }
});
test('タグのAND／OR／NOTは完全一致、部位・状態を合わせて絞り込む', async () => {
  const db = database();
  try {
    insert(db, 'a', { tags: ['スキンケア', '乾燥肌'] });
    insert(db, 'b', { category: 'hair', tags: ['ヘアケア', '乾燥肌'] });
    insert(db, 'c', {
      category: 'nail',
      tags: ['爪ケア'],
      status: 'published',
    });
    insert(db, 'd', { tags: ['乾燥肌ケア'], status: 'rejected' });
    assert.deepEqual(
      ids(
        await search(db, { tags: 'スキンケア,乾燥肌', tag_mode: 'and' }),
      ),
      ['a'],
    );
    assert.deepEqual(
      ids(
        await search(db, {
          tags: 'スキンケア,爪ケア',
          tag_mode: 'or',
          status: 'all',
        }),
      ),
      ['a', 'c'],
    );
    assert.deepEqual(
      ids(
        await search(db, {
          tags: '乾燥肌',
          tag_mode: 'not',
          status: 'all',
        }),
      ),
      ['c', 'd'],
    );
    const params = new URLSearchParams({ status: 'all' });
    params.append('category', 'skin');
    params.append('category', 'nail');
    assert.deepEqual(ids(await articleList(db, params)), ['a', 'c', 'd']);
    assert.deepEqual(
      ids(
        await search(db, {
          status: 'published',
          category: 'nail',
          tags: '爪ケア',
        }),
      ),
      ['c'],
    );
    const metadata = await filterOptions(db);
    assert.ok(metadata.tags.includes('乾燥肌'));
    assert.equal(metadata.time_zone, 'Asia/Tokyo');
  } finally {
    db.sql.close();
  }
});
test('年代・年・月・期間は日本時間、終了日を含め、公開日と更新日を選べる', async () => {
  const db = database();
  try {
    insert(db, 'before', { created: '2026-09-30T14:59:59.999Z' });
    insert(db, 'start', { created: '2026-09-30T15:00:00.000Z' });
    insert(db, 'end', { created: '2026-10-31T14:59:59.999Z' });
    insert(db, 'after', { created: '2026-10-31T15:00:00.000Z' });
    insert(db, 'old', {
      created: '2019-12-31T14:59:59.999Z',
      updated: '2026-10-01T00:00:00.000Z',
      status: 'published',
      published: '2026-10-05T12:00:00.000Z',
    });
    assert.deepEqual(ids(await search(db, { month: '2026-10' })), [
      'end',
      'start',
    ]);
    assert.deepEqual(
      ids(await search(db, { from: '2026-10-01', to: '2026-10-31' })),
      ['end', 'start'],
    );
    assert.deepEqual(
      ids(await search(db, { decade: '2020', year: '2026' })),
      ['after', 'before', 'end', 'start'],
    );
    assert.deepEqual(
      ids(
        await search(db, {
          date_basis: 'updated',
          status: 'all',
          month: '2026-10',
        }),
      ),
      ['end', 'old', 'start'],
    );
    assert.deepEqual(
      ids(
        await search(db, {
          date_basis: 'published',
          status: 'all',
          from: '2026-10-05',
          to: '2026-10-05',
        }),
      ),
      ['old'],
    );
    assert.deepEqual(
      ids(await search(db, { year: '2025', month: '2026-10' })),
      [],
    );
  } finally {
    db.sql.close();
  }
});
test('検索索引とタグは本文・確認メモ・タグの変更および削除に追従する', async () => {
  const db = database();
  try {
    insert(db, 'a', {
      title: '旧タイトル',
      body: '旧成分',
      tags: ['旧タグ'],
      notes: '旧確認メモ',
    });
    db.sql
      .prepare(
        'UPDATE articles SET title=?,body_markdown=?,tags=?,ai_check_notes=? WHERE id=?',
      )
      .run('新タイトル', '新成分', '["新タグ"]', '新確認メモ', 'a');
    for (const q of ['旧タイトル', '旧成分', '旧タグ'])
      assert.equal((await search(db, { q })).total, 0);
    for (const q of ['新タイトル', '新成分', '新タグ'])
      assert.equal((await search(db, { q })).total, 1);
    assert.equal(
      (await search(db, { q: '新確認メモ', scope: 'notes' })).total,
      1,
    );
    assert.equal((await search(db, { tags: '旧タグ' })).total, 0);
    assert.equal((await search(db, { tags: '新タグ' })).total, 1);
    db.sql
      .prepare('DELETE FROM article_versions WHERE article_id=?')
      .run('a');
    db.sql.prepare('DELETE FROM articles WHERE id=?').run('a');
    assert.equal((await search(db, { q: '新成分' })).total, 0);
    assert.equal((await filterOptions(db)).tags.length, 0);
  } finally {
    db.sql.close();
  }
});
test('同じ日付でもカーソルで重複なく全件を新旧どちらの順でも取得する', async () => {
  const db = database();
  try {
    for (let i = 0; i < 121; i++) insert(db, String(i).padStart(3, '0'));
    for (const sort of ['newest', 'oldest']) {
      let cursor = null,
        all = [],
        pages = 0;
      do {
        const params = { sort };
        if (cursor) params.cursor = cursor;
        const result = await search(db, params);
        assert.equal(result.total, pages ? null : 121);
        all.push(...result.articles.map((r) => r.id));
        cursor = result.next_cursor;
        pages++;
      } while (cursor);
      assert.equal(pages, 3);
      assert.equal(new Set(all).size, 121);
      assert.equal(all[0], sort === 'newest' ? '120' : '000');
    }
  } finally {
    db.sql.close();
  }
});
test('ワイルドカードやSQLは語句として扱い、不正な式・条件を400で拒否する', async () => {
  const db = database();
  try {
    insert(db, 'a', { title: '濃度100%_記号', body: 'ANDとORの説明' });
    insert(db, 'b', { title: '濃度100xx記号' });
    assert.deepEqual(ids(await search(db, { q: '100%_' })), ['a']);
    assert.equal((await search(db, { q: "' OR 1=1 --" })).total, 0);
    assert.deepEqual(
      ids(await search(db, { q: '"AND"', scope: 'body' })),
      ['a'],
    );
    for (const q of [
      '保湿 OR',
      'AND 保湿',
      '()',
      '(保湿',
      '保湿)',
      '"未完',
      '""',
      Array(13).fill('語').join(' OR '),
      '('.repeat(10) + '保湿' + ')'.repeat(10),
    ])
      assert.throws(
        () => parseExpression(q),
        (e) => e.status === 400 && !!e.userMessage,
        q,
      );
    for (const params of [
      { month: '2026-13' },
      { from: '2026-02-30' },
      { from: '2026-10-02', to: '2026-10-01' },
      { decade: '2026' },
      { year: '0200' },
      { category: 'beauty' },
      { scope: 'x);DROP TABLE articles;--' },
      { cursor: 'bad' },
      { tag_mode: 'xor' },
    ])
      assert.throws(
        () => searchPlan(new URLSearchParams(params)),
        (e) => e.status === 400 && !!e.userMessage,
      );
    assert.doesNotThrow(() =>
      searchPlan(
        new URLSearchParams({ from: '2024-02-29', to: '2024-02-29' }),
      ),
    );
  } finally {
    db.sql.close();
  }
});
