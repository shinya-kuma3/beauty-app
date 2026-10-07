import test from 'node:test';
import assert from 'node:assert/strict';
import { allMatches, matchCare } from '../src/lib/finder.mjs';
import { loadRecords } from '../scripts/validate-content.mjs';
const records = await loadRecords();
test('全36通りの結果は公開済みかつ部位に対応する成分・記事だけを参照する', () => {
  const results = allMatches();
  assert.equal(results.length, 36);
  assert.equal(new Set(results.map(result => result.slug)).size, 36);
  for (const result of results) {
    assert.ok(result.recommendations.length >= 2 && result.recommendations.length <= 3);
    assert.ok(records.some(record => record.collection === 'articles' && record.id === result.area.article && record.data.status === 'published'));
    for (const recommendation of result.recommendations) {
      const ingredient = records.find(record => record.collection === 'ingredients' && record.id === recommendation.id);
      assert.equal(ingredient?.data.status, 'published');
      assert.ok((ingredient.data.areas || [ingredient.data.category]).includes(result.area.id));
      assert.ok(recommendation.reason);
    }
  }
});
test('状態も目標もおすすめに反映する', () => {
  assert.equal(matchCare('body', 'rough', 'local').recommendations[0].id, 'urea');
  assert.equal(matchCare('body', 'dry', 'moist').recommendations[0].id, 'ceramide');
  assert.notDeepEqual(matchCare('hair', 'dry', 'moist').recommendations, matchCare('hair', 'tangled', 'smooth').recommendations);
  assert.notDeepEqual(matchCare('skin', 'dry', 'moist').recommendations, matchCare('skin', 'dry', 'comfortable').recommendations);
});
test('不正な部位・状態・目標を結果にしない', () => {
  for (const values of [['unknown', 'dry', 'moist'], ['nail', 'mixed', 'protect'], ['hair', 'dry', 'protect']]) assert.equal(matchCare(...values), null);
});
