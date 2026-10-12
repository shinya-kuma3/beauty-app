import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { tagPickerMarkup } from '../src/lib/tag-picker-markup.mjs';
const script = await readFile(
  new URL('../public/tag-picker.js', import.meta.url),
  'utf8',
);
function setup(tags) {
  const window = new Window({
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  window.document.write(tagPickerMarkup('test'));
  window.eval(script);
  const root = window.document.getElementById('test');
  let changes = 0;
  const picker = window.BeautyTagPicker.create(root, {
    tags,
    onChange: () => changes++,
  });
  return { window, root, picker, changes: () => changes };
}
test('モーダルで登録済みタグを選択、絞り込みでも選択を保持、キャンセルでは変更しない', async () => {
  const s = setup(['乾燥肌', 'ヘアケア', '保湿,乾燥', '乾燥肌']);
  try {
    const open = s.root.querySelector('[data-tag-open]'),
      dialog = s.root.querySelector('dialog');
    open.click();
    assert.equal(dialog.open, true);
    assert.equal(
      s.root.querySelectorAll('[data-tag-choices] input').length,
      3,
    );
    const check = s.root.querySelector('input[value="乾燥肌"]');
    check.checked = true;
    check.dispatchEvent(new s.window.Event('change'));
    const query = s.root.querySelector('[data-tag-query]');
    query.value = 'ヘア';
    query.dispatchEvent(new s.window.Event('input'));
    assert.equal(
      s.root.querySelectorAll('[data-tag-choices] input').length,
      1,
    );
    s.root.querySelector('[data-tag-apply]').click();
    assert.deepEqual([...s.picker.getSelected()], ['乾燥肌']);
    assert.equal(dialog.open, false);
    assert.equal(s.changes(), 1);
    assert.equal(s.window.document.activeElement, open);
    open.click();
    s.root.querySelector('[data-tag-clear]').click();
    s.root.querySelector('[data-tag-cancel]').click();
    assert.deepEqual([...s.picker.getSelected()], ['乾燥肌']);
    open.click();
    s.root.querySelector('[data-tag-clear]').click();
    s.root.querySelector('[data-tag-apply]').click();
    assert.equal(s.picker.getSelected().length, 0);
    s.picker.setSelected(['<script>', '保湿,乾燥']);
    assert.deepEqual(
      JSON.parse(s.root.querySelector('[data-tag-value]').value),
      ['保湿,乾燥'],
    );
    assert.equal(
      s.root.querySelector('[data-tag-selected]').textContent,
      '保湿,乾燥',
    );
  } finally {
    await s.window.happyDOM.close();
  }
});
test('選択は最大10個、追加の選択を拒否し、タグがない場合も開ける', async () => {
  const s = setup(Array.from({ length: 11 }, (_, i) => 'タグ' + i));
  try {
    s.root.querySelector('[data-tag-open]').click();
    for (const check of s.root.querySelectorAll(
      '[data-tag-choices] input',
    )) {
      check.checked = true;
      check.dispatchEvent(new s.window.Event('change'));
    }
    assert.match(
      s.root.querySelector('[data-tag-status]').textContent,
      /最大10個/,
    );
    s.root.querySelector('[data-tag-apply]').click();
    assert.equal(s.picker.getSelected().length, 10);
    s.picker.setTags([]);
    s.root.querySelector('[data-tag-open]').click();
    assert.match(
      s.root.querySelector('[data-tag-choices]').textContent,
      /まだありません/,
    );
  } finally {
    await s.window.happyDOM.close();
  }
});
