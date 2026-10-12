(() => {
  const normalize = (value) =>
    (value || '').normalize('NFKC').toLocaleLowerCase('ja').trim();
  function filter(records, params) {
    const words = normalize(params.get('q')).split(/\s+/).filter(Boolean),
      excluded = normalize(params.get('exclude'))
        .split(/\s+/)
        .filter(Boolean),
      categories = params.getAll('category'),
      tags = params.getAll('tag'),
      scope = params.get('scope') || 'content';
    if (words.length + excluded.length > 12)
      throw new Error(
        '検索する言葉と含めない言葉は合わせて最大12個です。',
      );
    const from = params.get('from'),
      to = params.get('to'),
      month = params.get('month');
    const validDate = (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
    if (
      (from && !validDate(from)) ||
      (to && !validDate(to)) ||
      (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    )
      throw new Error('年月・日付を確認してください。');
    if (from && to && from > to)
      throw new Error('開始日は終了日以前にしてください。');
    return records
      .filter((record) => {
        if (
          categories.length &&
          !categories.some((c) => record.areas.includes(c))
        )
          return false;
        if (
          tags.length &&
          !(params.get('tag_mode') === 'and'
            ? tags.every((t) => record.tags.includes(t))
            : tags.some((t) => record.tags.includes(t)))
        )
          return false;
        if (month && !record.updatedAt.startsWith(month)) return false;
        if (from && record.updatedAt < from) return false;
        if (to && record.updatedAt > to) return false;
        const text = normalize(
          scope === 'title'
            ? record.title
            : scope === 'body'
              ? record.body
              : [
                  record.title,
                  record.summary,
                  record.body,
                  ...record.tags,
                ].join(' '),
        );
        if (
          words.length &&
          !(params.get('keyword_mode') === 'any'
            ? words.some((word) => text.includes(word))
            : words.every((word) => text.includes(word)))
        )
          return false;
        return !excluded.some((word) => text.includes(word));
      })
      .sort(
        (a, b) =>
          (params.get('sort') === 'oldest'
            ? a.updatedAt.localeCompare(b.updatedAt)
            : b.updatedAt.localeCompare(a.updatedAt)) ||
          a.id.localeCompare(b.id),
      );
  }
  function initialize(doc) {
    const form = doc.getElementById('public-article-filters');
    if (!form || form.dataset.ready) return;
    form.dataset.ready = 'true';
    const win = doc.defaultView,
      records = JSON.parse(
        doc.getElementById('article-search-data').textContent,
      ),
      grid = doc.querySelector('[data-article-grid]'),
      cards = new Map(
        [...grid.children].map((card) => [card.dataset.articleId, card]),
      ),
      count = doc.getElementById('public-article-count'),
      message = doc.getElementById('public-search-message'),
      empty = doc.getElementById('public-article-empty');
    const picker = win.BeautyTagPicker.create(
      doc.getElementById('article-tags'),
      { tags: records.flatMap((r) => r.tags) },
    );
    function read() {
      const params = new URLSearchParams();
      for (const field of form.elements) {
        if (
          !field.name ||
          !field.value ||
          (field.type === 'checkbox' && !field.checked)
        )
          continue;
        if (field.name === 'selected_tags') {
          for (const tag of picker.getSelected())
            params.append('tag', tag);
        } else params.append(field.name, field.value.trim());
      }
      return params;
    }
    function render(params, updateUrl = false) {
      try {
        const found = filter(records, params),
          ids = new Set(found.map((r) => r.id));
        for (const [id, card] of cards) card.hidden = !ids.has(id);
        for (const record of found) grid.append(cards.get(record.id));
        count.textContent = found.length + '件の記事';
        empty.hidden = !!found.length;
        message.textContent = '';
        if (updateUrl) {
          const url = new URL(win.location.href);
          url.search = params.toString();
          win.history.replaceState(null, '', url);
        }
      } catch (error) {
        message.textContent = error.message;
      }
    }
    function restore() {
      const params = new URLSearchParams(win.location.search);
      form.reset();
      for (const field of form.elements) {
        if (!field.name || field.name === 'selected_tags') continue;
        if (field.type === 'checkbox')
          field.checked = params.getAll(field.name).includes(field.value);
        else if (params.has(field.name)) {
          const value = params.get(field.name);
          if (field.tagName === 'SELECT') {
            if ([...field.options].some((o) => o.value === value))
              field.value = value;
          } else field.value = value;
        }
      }
      picker.setSelected(params.getAll('tag'));
      render(read());
    }
    form.onsubmit = (event) => {
      event.preventDefault();
      render(read(), true);
    };
    doc.getElementById('public-reset-search').onclick = () => {
      form.reset();
      picker.setSelected([]);
      render(read(), true);
    };
    win.addEventListener('popstate', restore);
    restore();
    doc.querySelector('[data-article-search-panel]').hidden = false;
  }
  globalThis.BeautyArticleListing = { filter, initialize };
  if (typeof document !== 'undefined') initialize(document);
})();
