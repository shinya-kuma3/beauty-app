import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/article-listing.js';
const { filter } = globalThis.BeautyArticleListing;
const records = [
  {
    id: 'skin',
    title: 'セラミドと保湿',
    summary: '乾燥を考える',
    body: '香料を含まないとは限らない',
    tags: ['スキンケア', '乾燥肌'],
    areas: ['skin', 'body'],
    updatedAt: '2026-10-01',
  },
  {
    id: 'hair',
    title: '髪の洗い方',
    summary: '髪をやさしく',
    body: 'シャンプーと頭皮',
    tags: ['ヘアケア'],
    areas: ['hair'],
    updatedAt: '2026-09-30',
  },
  {
    id: 'nail',
    title: '爪の保湿',
    summary: '乾燥を考える',
    body: 'ANDという文字を例示',
    tags: ['乾燥肌', '爪ケア'],
    areas: ['nail'],
    updatedAt: '2025-10-01',
  },
];
const ids = (params) =>
  filter(records, new URLSearchParams(params)).map((r) => r.id);
test('公開記事のキーワードを普通の語句として検索し、含め方・除外・検索対象を反映する', () => {
  assert.deepEqual(ids({ q: 'セラミド 保湿', keyword_mode: 'all' }), [
    'skin',
  ]);
  assert.deepEqual(ids({ q: 'セラミド 髪', keyword_mode: 'any' }), [
    'skin',
    'hair',
  ]);
  assert.deepEqual(ids({ q: '保湿', exclude: '香料' }), ['nail']);
  assert.deepEqual(ids({ q: 'AND' }), ['nail']);
  assert.deepEqual(ids({ q: 'ａｎｄ' }), ['nail']);
  assert.deepEqual(ids({ q: '乾燥', scope: 'title' }), []);
  assert.deepEqual(ids({ q: 'シャンプー', scope: 'body' }), ['hair']);
});
test('公開記事の部位・タグ・年月・期間・並び替えを組み合わせる', () => {
  const params = new URLSearchParams({ month: '2026-10' });
  params.append('category', 'body');
  params.append('tag', '乾燥肌');
  assert.deepEqual(
    filter(records, params).map((r) => r.id),
    ['skin'],
  );
  const tags = new URLSearchParams({ tag_mode: 'or' });
  tags.append('tag', 'ヘアケア');
  tags.append('tag', '爪ケア');
  assert.deepEqual(
    filter(records, tags).map((r) => r.id),
    ['hair', 'nail'],
  );
  tags.set('tag_mode', 'and');
  assert.deepEqual(filter(records, tags), []);
  assert.deepEqual(ids({ from: '2026-09-30', to: '2026-09-30' }), [
    'hair',
  ]);
  assert.deepEqual(ids({ sort: 'oldest' }), ['nail', 'hair', 'skin']);
  assert.deepEqual(ids({ month: '2025-10', from: '2026-01-01' }), []);
  assert.throws(
    () => ids({ from: '2026-10-02', to: '2026-10-01' }),
    /開始日/,
  );
  assert.throws(() => ids({ from: '2026-02-30' }), /日付/);
  assert.throws(() => ids({ month: '2026-13' }), /日付/);
  assert.throws(
    () => ids({ q: Array(13).fill('言葉').join(' ') }),
    /最大12個/,
  );
});
