import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadRecords } from './validate-content.mjs';
import { allMatches } from '../src/lib/finder.mjs';
const records = await loadRecords();
const index = JSON.parse(
  await readFile('dist/search-index.json', 'utf8'),
);
const published = records.filter((r) => r.data.status === 'published');
const manifest = JSON.parse(
  await readFile('dist/content-manifest.json', 'utf8'),
);
assert.equal(
  index.length,
  published.length + manifest.articles.length,
  '検索には公開済みだけを出力する',
);
for (const entry of published) {
  await access(resolve('dist', entry.collection, entry.id, 'index.html'));
  assert.ok(
    index.some((item) => item.title === entry.data.title),
    `検索に ${entry.id} が存在する`,
  );
}
for (const entry of records.filter(
  (r) => r.data.status !== 'published',
)) {
  assert.ok(!index.some((item) => item.title === entry.data.title));
  await assert.rejects(
    access(resolve('dist', entry.collection, entry.id, 'index.html')),
  );
}
for (const page of [
  'index.html',
  'ingredients/index.html',
  'articles/index.html',
  'search/index.html',
  'about/index.html',
  'mens/index.html',
  'finder/index.html',
  '404.html',
])
  await access(resolve('dist', page));
for (const result of allMatches()) {
  const html = await readFile(
    resolve('dist/finder/result', result.slug, 'index.html'),
    'utf8',
  );
  for (const recommendation of result.recommendations)
    assert.ok(
      html.includes(`/ingredients/${recommendation.id}/`),
      `${result.slug}: 成分詳細へのリンク`,
    );
  assert.ok(
    html.includes(`/articles/${result.area.article}/`),
    `${result.slug}: ケア記事へのリンク`,
  );
}
// Exercise the scripts against the actual generated public page.
const { Window } = await import('happy-dom');
const window = new Window({
  url: 'https://example.test/articles/',
  settings: {
    enableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    suppressInsecureJavaScriptEnvironmentWarning: true,
  },
});
try {
  window.document.write(
    await readFile('dist/articles/index.html', 'utf8'),
  );
  window.eval(await readFile('dist/tag-picker.js', 'utf8'));
  window.eval(await readFile('dist/article-listing.js', 'utf8'));
  const doc = window.document,
    form = doc.getElementById('public-article-filters'),
    cards = [...doc.querySelector('[data-article-grid]').children],
    payload = JSON.parse(
      doc.getElementById('article-search-data').textContent,
    );
  assert.equal(
    payload.length,
    published.filter((r) => r.collection === 'articles').length +
      manifest.articles.length,
  );
  assert.equal(cards.length, payload.length);
  assert.equal(
    doc.querySelector('[data-article-search-panel]').hidden,
    false,
  );
  assert.doesNotMatch(form.textContent, /\b(?:AND|OR|NOT)\b/);
  assert.ok(
    payload.every((r) => !('ai_check_notes' in r) && !('sources' in r)),
  );
  doc.getElementById('public-query').value = 'zz-no-matching-article';
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.ok(cards.every((card) => card.hidden));
  assert.equal(doc.getElementById('public-article-empty').hidden, false);
  doc.getElementById('public-reset-search').click();
  assert.ok(cards.every((card) => !card.hidden));
  const picker = doc.getElementById('article-tags');
  picker.querySelector('[data-tag-open]').click();
  assert.equal(picker.querySelector('dialog').open, true);
  const tags = [...new Set(payload.flatMap((r) => r.tags))];
  assert.equal(
    picker.querySelectorAll('[data-tag-choices] input').length,
    tags.length,
  );
  const checkbox = picker.querySelector('[data-tag-choices] input');
  assert.ok(checkbox);
  checkbox.checked = true;
  checkbox.dispatchEvent(new window.Event('change'));
  picker.querySelector('[data-tag-apply]').click();
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  const visible = payload.filter(
    (r) => !doc.querySelector('[data-article-id="' + r.id + '"]').hidden,
  );
  assert.ok(visible.length > 0);
  assert.ok(visible.every((r) => r.tags.includes(checkbox.value)));
  assert.deepEqual(
    new URL(window.location.href).searchParams.getAll('tag'),
    [checkbox.value],
  );
  const before = doc.getElementById('public-article-count').textContent;
  doc.getElementById('public-from').value = '2026-10-02';
  doc.getElementById('public-to').value = '2026-10-01';
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.match(
    doc.getElementById('public-search-message').textContent,
    /開始日/,
  );
  assert.equal(
    doc.getElementById('public-article-count').textContent,
    before,
  );
} finally {
  await window.happyDOM.close();
}
console.log(
  `Build verified: ${published.length} detail pages, public search index, navigation pages`,
);
