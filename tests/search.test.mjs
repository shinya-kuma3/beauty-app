import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEntries } from '../src/lib/search.mjs';
const entries = [
  { title: 'ナイアシンアミド', englishName: 'Niacinamide', summary: 'ビタミンＢ３の一種', category: 'skin', type: 'ingredient', tags: ['整肌'], sections: [{ heading: '配合', body: '保湿製品にも使用' }] },
  { title: '髪を洗う', summary: '頭皮のケア', category: 'hair', type: 'article', tags: ['ヘアケア'], sections: [] },
];
test('英語の大文字小文字と全角英数字を正規化する', () => { assert.equal(filterEntries(entries, { query: 'ＮＩＡＣＩＮＡＭＩＤＥ' }).length, 1); assert.equal(filterEntries(entries, { query: 'ビタミンB3' }).length, 1); });
test('本文を含めて複数キーワードを AND 検索する', () => { assert.equal(filterEntries(entries, { query: '整肌 保湿' }).length, 1); assert.equal(filterEntries(entries, { query: '整肌 頭皮' }).length, 0); });
test('カテゴリと種類を同時に絞り込む', () => { assert.equal(filterEntries(entries, { category: 'hair', type: 'article' }).length, 1); assert.equal(filterEntries(entries, { category: 'hair', type: 'ingredient' }).length, 0); });
test('空白検索はすべて、未知のキーワードは0件', () => { assert.equal(filterEntries(entries, { query: '　 ' }).length, 2); assert.equal(filterEntries(entries, { query: '存在しない成分' }).length, 0); });
test('共通成分は複数の部位から検索でき、対象外の部位に出ない', () => {
  const shared = [{ ...entries[0], category: 'nail', areas: ['nail', 'skin', 'body'] }];
  for (const category of ['nail', 'skin', 'body']) assert.equal(filterEntries(shared, { category }).length, 1);
  assert.equal(filterEntries(shared, { category: 'hair' }).length, 0);
});
