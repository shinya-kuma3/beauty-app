import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRecords, validateRecords } from '../scripts/validate-content.mjs';
const records = await loadRecords();
test('初期コンテンツが公開条件を満たす', () => assert.deepEqual(validateRecords(records), []));
test('存在しない関連成分を拒否する', () => { const copy = structuredClone(records); copy.find((r) => r.collection === 'articles' && r.data.status === 'published').data.relatedIngredients = ['missing-ingredient']; assert.ok(validateRecords(copy).some((e) => e.includes('missing-ingredient'))); });
test('存在しない日付を拒否する', () => { const copy = structuredClone(records); copy[0].data.updatedAt = '2026-02-30'; assert.ok(validateRecords(copy).some((e) => e.includes('実在する'))); });
test('X だけを根拠にした公開を拒否するが下書きでは保管できる', () => { const copy = structuredClone(records); copy[0].data.sources = [{ title: '投稿', url: 'https://x.com/example/status/1', kind: 'x' }]; assert.ok(validateRecords(copy).some((e) => e.includes('X 以外'))); copy[0].data.status = 'draft'; copy.forEach((r) => { if (r.collection === 'articles') r.data.relatedIngredients = []; }); assert.deepEqual(validateRecords(copy), []); });
test('実行可能な出典 URL と任意 slug を拒否する', () => { const copy = structuredClone(records); copy[0].data.sources[0].url = 'javascript:alert(1)'; copy[0].data.slug = '../injected'; const errors = validateRecords(copy); assert.ok(errors.some((e) => e.includes('HTTPS'))); assert.ok(errors.some((e) => e.includes('slug'))); });
