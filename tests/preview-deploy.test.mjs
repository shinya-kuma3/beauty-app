import test from 'node:test';
import assert from 'node:assert/strict';
import {
  previewSecrets,
  requiredSecrets,
} from '../scripts/deploy-preview.mjs';
const name = 'codex/content-review-pipeline';
const list = (keys) =>
  '│ Preview: ' +
  name +
  ' │\n│ Secrets │\n' +
  keys
    .map((k) => '│   ' + k + '   Environment Variable   ******** │')
    .join('\n');
test('Preview更新時に全シークレットを引き継ぎ、追加のキーも保存する', () => {
  assert.deepEqual(
    previewSecrets(
      list([...requiredSecrets, 'CONTENT_DEPLOY_HOOK', 'future.api-key']),
      name,
    ),
    [...requiredSecrets, 'CONTENT_DEPLOY_HOOK', 'future.api-key'],
  );
});
test('キーの不足・別のPreview・一覧の形式変更でデプロイを停止する', () => {
  assert.throws(
    () => previewSecrets(list(requiredSecrets.slice(1)), name),
    /INGEST_API_KEY/,
  );
  assert.throws(
    () => previewSecrets(list(requiredSecrets), 'develop'),
    /format changed/,
  );
  assert.throws(() => previewSecrets('{}', name), /format changed/);
});
