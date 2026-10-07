import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadRecords } from './validate-content.mjs';
const records = await loadRecords();
const index = JSON.parse(await readFile('dist/search-index.json', 'utf8'));
const published = records.filter((r) => r.data.status === 'published');
assert.equal(index.length, published.length, '検索には公開済みだけを出力する');
for (const entry of published) {
  await access(resolve('dist', entry.collection, entry.id, 'index.html'));
  assert.ok(index.some((item) => item.title === entry.data.title), `検索に ${entry.id} が存在する`);
}
for (const entry of records.filter((r) => r.data.status !== 'published')) {
  assert.ok(!index.some((item) => item.title === entry.data.title));
  await assert.rejects(access(resolve('dist', entry.collection, entry.id, 'index.html')));
}
for (const page of ['index.html', 'ingredients/index.html', 'articles/index.html', 'search/index.html', 'about/index.html', '404.html']) await access(resolve('dist', page));
console.log(`Build verified: ${published.length} detail pages, public search index, navigation pages`);
