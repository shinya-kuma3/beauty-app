import {publicReferences} from '../shared/editorial-policy.mjs';
import {parseVisibility} from '../shared/withdrawal-content.mjs';
import { readFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadRecords } from './validate-content.mjs';
import { allMatches } from '../src/lib/finder.mjs';
const records = await loadRecords();
const hidden=new Set(parseVisibility(await readFile('src/content/withdrawn-articles.json','utf8')).withdrawals.map(row=>row.slug));
const visible=r=>r.data.status==='published'&&!(r.collection==='articles'&&hidden.has(r.id));
const index = JSON.parse(
  await readFile('dist/search-index.json', 'utf8'),
);
let published = records.filter(visible);
const manifest = JSON.parse(
  await readFile('dist/content-manifest.json', 'utf8'),
);
const overridden=new Set(manifest.articles.map(row=>row.original_slug).filter(Boolean));
published=published.filter(row=>row.collection!=='articles'||!overridden.has(row.id));
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
  (r) => !visible(r) && !(r.collection==='articles'&&overridden.has(r.id)),
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
    html.includes(hidden.has(result.area.article)?'/articles/':`/articles/${result.area.article}/`),
    `${result.slug}: ケア記事へのリンク`,
  );
}
// Exercise the scripts against the actual generated public page.
const { Window } = await import('happy-dom');
const { renderPublicMarkdown } = await import('../worker/core.mjs');
for (const entry of published.filter(row => row.collection === 'ingredients')) {
  const { id } = entry;
  const page = new Window({settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  try {
    page.document.write(await readFile('dist/ingredients/' + id + '/index.html','utf8'));
    const record = index.find(row => row.url.endsWith('/ingredients/' + id + '/'));
    assert.ok(record, id + ': public search entry');
    assert.equal(page.document.querySelector('h1').textContent, record.title);
    assert.equal(page.document.querySelector('.sources'), null, id + ': no scientific reference panel');
    const paragraphs = [...page.document.querySelectorAll('.detail-body section p')];
    assert.equal(paragraphs.length, entry.data.sections.length);
    entry.data.sections.forEach((section, i) => {
      assert.equal(paragraphs[i].textContent, section.body, id + ': marker preserves original text');
      const markers = [...paragraphs[i].querySelectorAll('mark.point-marker')];
      assert.equal(markers.length, section.highlight ? 1 : 0);
      if (section.highlight) assert.equal(markers[0].textContent, section.highlight);
    });
    if (id === 'booster') {
      assert.equal(record.entryType, 'care-item');
      assert.match(page.document.querySelector('.detail-meta').textContent, /ケアアイテム/);
      assert.equal(page.document.querySelector('.detail-header .eyebrow').textContent, 'CARE ITEM NOTE');
    }
  } finally { await page.happyDOM.close(); }
}
const { parseSnapshot, digest } =
  await import('../shared/release-content.mjs');
for (const folder of ['approved-articles', 'generated-articles']) {
  let files = [];
  try {
    files = await readdir('src/content/' + folder);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of files.filter((f) => f.endsWith('.json'))) {
    const content = await readFile(
        'src/content/' + folder + '/' + name,
        'utf8',
      ),
      snapshot = parseSnapshot(content);
    const entry = manifest.articles.find(
      (row) =>
        row.id === snapshot.dbId &&
        row.revision === snapshot.reviewRevision,
    );
    if (!entry) continue;
    if (entry.sha) assert.equal(entry.sha, await digest(content));
    const detail = new Window({
      settings: {
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
      },
    });
    try {
      detail.document.write(
        await readFile(
          'dist/articles/' + name.slice(0, -5) + '/index.html',
          'utf8',
        ),
      );
      assert.equal(
        detail.document.querySelector('h1').textContent,
        snapshot.title,
      );
      const expected = detail.document.createElement('div');
      expected.innerHTML = renderPublicMarkdown(snapshot.bodyMarkdown);
      assert.equal(
        detail.document
          .querySelector('.markdown-body')
          .textContent.replace(/\s+/g, ' ')
          .trim(),
        expected.textContent.replace(/\s+/g, ' ').trim(),
        'Rendered article differs from approved Markdown',
      );
      for (const source of publicReferences(snapshot.sources))
        assert.ok(
          [...detail.document.querySelectorAll('a')].some(
            (a) => a.getAttribute('href') === source.url,
          ),
        );
      assert.match(
        detail.document.querySelector('.detail-note').textContent,
        /AI/,
      );
    } finally {
      await detail.happyDOM.close();
    }
  }
}
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
