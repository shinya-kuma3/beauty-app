(() => {
  function create(root, { tags = [], onChange = () => {} } = {}) {
    const doc = root.ownerDocument,
      dialog = root.querySelector('[data-tag-dialog]'),
      value = root.querySelector('[data-tag-value]'),
      choices = root.querySelector('[data-tag-choices]'),
      status = root.querySelector('[data-tag-status]'),
      query = root.querySelector('[data-tag-query]'),
      opener = root.querySelector('[data-tag-open]');
    let available = [],
      selected = [],
      draft = new Set();
    const normalize = (text) =>
      text.normalize('NFKC').toLocaleLowerCase('ja');
    function commit(items) {
      selected = [...new Set(items)]
        .filter((tag) => available.includes(tag))
        .slice(0, 10);
      value.value = JSON.stringify(selected);
      const preview = root.querySelector('[data-tag-selected]');
      preview.replaceChildren();
      if (!selected.length) preview.textContent = '指定なし';
      for (const tag of selected) {
        const chip = doc.createElement('span');
        chip.className = 'tag-selection-chip';
        chip.textContent = tag;
        preview.append(chip);
      }
      opener.textContent = selected.length
        ? 'タグを変更（' + selected.length + '個）'
        : 'タグを選択';
    }
    function render() {
      choices.replaceChildren();
      const found = available.filter((tag) =>
        normalize(tag).includes(normalize(query.value.trim())),
      );
      for (const tag of found) {
        const label = doc.createElement('label'),
          checkbox = doc.createElement('input'),
          text = doc.createElement('span');
        checkbox.type = 'checkbox';
        checkbox.value = tag;
        checkbox.checked = draft.has(tag);
        text.textContent = tag;
        checkbox.onchange = () => {
          if (checkbox.checked && draft.size >= 10) {
            checkbox.checked = false;
            status.textContent = 'タグは最大10個まで選べます。';
            return;
          }
          if (checkbox.checked) draft.add(tag);
          else draft.delete(tag);
          status.textContent = draft.size + '個選択中';
        };
        label.append(checkbox, text);
        choices.append(label);
      }
      if (!found.length) {
        const p = doc.createElement('p');
        p.className = 'tag-picker-hint';
        p.textContent = available.length
          ? '一致するタグはありません。'
          : '記事に登録されたタグはまだありません。';
        choices.append(p);
      }
      status.textContent = draft.size + '個選択中';
    }
    function close() {
      dialog.close();
      opener.focus();
    }
    opener.onclick = () => {
      draft = new Set(selected);
      query.value = '';
      render();
      dialog.showModal();
      query.focus();
    };
    query.oninput = render;
    query.onkeydown = (event) => {
      if (event.key === 'Enter') event.preventDefault();
    };
    root
      .querySelectorAll('[data-tag-cancel]')
      .forEach((button) => (button.onclick = close));
    dialog.addEventListener('cancel', () => {
      draft = new Set(selected);
    });
    dialog.addEventListener('close', () => opener.focus());
    root.querySelector('[data-tag-clear]').onclick = () => {
      draft.clear();
      render();
    };
    root.querySelector('[data-tag-apply]').onclick = () => {
      commit([...draft]);
      close();
      onChange([...selected]);
    };
    function setTags(tags) {
      available = [...new Set(tags)].sort((a, b) =>
        a.localeCompare(b, 'ja'),
      );
      commit(selected);
    }
    setTags(tags);
    return {
      setTags,
      setSelected(items) {
        commit(items);
      },
      getSelected() {
        return [...selected];
      },
    };
  }
  globalThis.BeautyTagPicker = { create };
})();
