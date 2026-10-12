export function tagPickerMarkup(prefix) {
  return (
    '<div class="tag-picker" id="' +
    prefix +
    '" data-tag-picker><span class="tag-field-label">タグ</span><input type="hidden" name="selected_tags" value="[]" data-tag-value><button type="button" data-tag-open class="tag-picker-button" aria-haspopup="dialog">タグを選択</button><div data-tag-selected class="selected-tags" aria-live="polite">指定なし</div><dialog data-tag-dialog class="tag-dialog" aria-labelledby="' +
    prefix +
    '-title"><div class="tag-dialog-heading"><h2 id="' +
    prefix +
    '-title">タグを選択</h2><button type="button" data-tag-cancel class="tag-dialog-close" aria-label="タグの選択を閉じる">×</button></div><p class="tag-picker-hint">記事に登録されているタグから、最大10個選べます。</p><label class="tag-dialog-search" for="' +
    prefix +
    '-query">タグを探す<input id="' +
    prefix +
    '-query" type="search" data-tag-query placeholder="例：保湿、ヘアケア"></label><div data-tag-choices class="tag-choices"></div><p data-tag-status class="tag-picker-hint" role="status" aria-live="polite"></p><div class="tag-dialog-actions"><button type="button" data-tag-clear>選択を解除</button><button type="button" data-tag-apply class="tag-apply">選択を反映</button><button type="button" data-tag-cancel>キャンセル</button></div></dialog></div>'
  );
}
