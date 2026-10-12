const $ = (id) => document.getElementById(id);
let current = null,
  nextOffset = null,
  dirty = false,
  busy = false,
  identity = null,
  listed = [];
const states = {
  queued: '処理待ち',
  processing: '処理中',
  deferred: '翌日または次回の処理待ち',
  waiting: '次回の処理待ち',
  failed: '処理に失敗',
  complete: '処理済み',
  obsolete: '旧版の処理',
  pending_review: '確認待ち',
  published: '公開承認済み',
  rejected: '却下',
  building: 'サイトへ反映中',
  deployed: 'サイトへ反映済み',
  waiting_configuration: '公開設定待ち',
};
const messages = {
  unauthorized: '認証が必要です。',
  admin_access_required: '許可されたアカウントでログインしてください。',
  owner_required: 'この操作は管理者だけが行えます。',
  revision_conflict:
    '別の人またはAIによる更新が入りました。入力内容は残しています。必要な修正を控えてから「一覧を更新」で最新版を確認してください。',
  ai_processing_incomplete:
    '要約・タグの処理が終わってから公開できます。',
  independent_citation_required:
    'X・YouTube以外の参考資料も追加して確認してください。',
  rejected_source: '却下された素材が含まれています。',
  invalid_input: '入力内容を確認してください。',
  rate_limited:
    '操作の回数制限に達しました。少し待ってから再試行してください。',
  youtube_discovery_failed:
    '動画を取得できませんでした。YouTube APIの設定と制限を確認してください。',
  database_not_configured: 'データベースの設定が必要です。',
  bootstrap_admin_immutable: '管理者の権限はこの画面から変更できません。',
};
const failures = {
  daily_budget: '今日のAI上限に達しました。翌日の処理を待ってください。',
  gemini_quota: 'Geminiの利用制限に達しました。',
  gemini_key_missing: 'Geminiの設定が必要です。',
  cache_in_progress:
    '同じ内容を別の処理が確認中です。少し待ってから再試行してください。',
  invalid_review_json: 'AIの回答を読み取れませんでした。再試行できます。',
  invalid_summary_json:
    'AIの回答を読み取れませんでした。再試行できます。',
  provider_timeout_response_unknown:
    'AIの応答が時間内に届きませんでした。利用記録を確認してください。',
};
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
const date = (value) =>
  value ? new Date(value).toLocaleString('ja-JP') : '—';
async function api(path, method = 'GET', body) {
  const r = await fetch('/api/admin/' + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error('ログイン状態と管理画面の設定を確認してください。');
  }
  if (!r.ok)
    throw new Error(
      messages[data.error?.code] ||
        '処理できませんでした。入力と設定を確認してください。',
    );
  return data;
}
async function action(task) {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll('input,select,textarea')
    .forEach((f) => (f.disabled = true));
  $('message').textContent = '処理しています…';
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const message = await task();
    $('message').textContent =
      typeof message === 'string' ? message : '完了しました。';
  } catch (e) {
    $('message').textContent = e.message;
  } finally {
    busy = false;
    document
      .querySelectorAll('input,select,textarea')
      .forEach((f) => (f.disabled = false));
    document
      .querySelectorAll('button')
      .forEach((b) => (b.disabled = false));
    updateActions();
  }
}
function updateActions() {
  if (!current) return;
  const editable = current.status === 'pending_review';
  for (const f of $('editor').elements) f.disabled = busy || !editable;
  $('publish').disabled =
    busy ||
    !editable ||
    current.ai_status !== 'complete' ||
    !$('confirm').checked ||
    dirty;
  $('reject').disabled =
    busy || !editable || !$('confirm').checked || dirty;
  const applyTags=$('apply-ai-tags');
  if(applyTags) applyTags.disabled=busy||!editable;
  $('review-actions').hidden = !editable;
  for (const id of ['ai-check', 'ai-enrich'])
    $(id).disabled = busy || !editable || dirty;
  $('save-state').textContent = dirty
    ? '未保存の変更あり'
    : editable
      ? '保存済み'
      : '確認専用';
  $('save-state').classList.toggle('unsaved', dirty);
  $('revision-label').textContent =
    '版 ' + current.revision + ' ・ ' + date(current.updated_at);
}
function markDirty() {
  dirty = true;
  $('confirm').checked = false;
  updateActions();
}
function filterList() {
  const query = $('article-search').value.trim().toLowerCase();
  for (const b of $('articles').querySelectorAll('button'))
    b.hidden = !b.dataset.title.includes(query);
  $('article-count').textContent = listed.length + '件取得';
}
async function list(append = false) {
  const data = await api(
    'articles?status=' +
      $('status').value +
      '&offset=' +
      (append ? nextOffset : 0),
  );
  if (!append) {
    $('articles').replaceChildren();
    listed = [];
  }
  for (const row of data.articles) {
    listed.push(row);
    const b = el('button', undefined, 'article-item');
    b.dataset.title = row.title.toLowerCase();
    b.dataset.id = row.id;
    b.classList.toggle('selected', current?.id === row.id);
    b.append(
      el('strong', row.title),
      el('small', states[row.ai_status] + ' ・ ' + date(row.updated_at)),
    );
    b.onclick = () => {
      if (
        dirty &&
        !confirm('未保存の修正があります。記事を切り替えますか？')
      )
        return;
      action(() => openArticle(row.id));
    };
    $('articles').append(b);
  }
  nextOffset = data.next_offset;
  $('more').hidden = nextOffset === null;
  if (!listed.length)
    $('articles').append(
      el(
        'p',
        'この状態の記事はありません。Grok Botから記事を登録すると、確認待ちの一覧に届きます。',
        'hint',
      ),
    );
  filterList();
}
function renderCheck(check) {
  $('check-result').replaceChildren();
  if (!check) {
    $('check-state').textContent =
      'まだAIチェックをしていません。修正を保存してから実行してください。';
    return;
  }
  $('check-state').textContent =
    (check.stale
      ? '本文や出典が変わったため、前の結果です。再チェックしてください。 '
      : '') +
    (states[check.state] || check.state) +
    (check.error_code
      ? ' ・ ' +
        (failures[check.error_code] ||
          '処理に失敗しました。再試行できます。')
      : '');
  $('check-result').append(
    el(
      'p',
      '依頼者: ' + check.requested_by + ' ・ ' + date(check.created_at),
      'hint',
    ),
  );
  if (!check.result) return;
  const scope = el('div', undefined, 'notice');
  scope.append(
    el(
      'strong',
      check.reviewed_chars < check.body_chars
        ? '本文の一部を点検しました'
        : '本文全体が入力対象です',
    ),
    el(
      'p',
      '本文 ' +
        check.reviewed_chars.toLocaleString() +
        ' / ' +
        check.body_chars.toLocaleString() +
        '文字。素材は短く抜粋しています。出典リンクの原文は未確認です。',
    ),
    el('p', date(check.completed_at) + ' ・ ' + check.model, 'hint'),
  );
  $('check-result').append(scope, el('p', check.result.overview));
  const categories = {
    claim: '断定表現',
    evidence: '根拠',
    wording: '表記',
    consistency: '整合性',
  };
  if (!check.result.findings.length)
    $('check-result').append(
      el(
        'p',
        'AIによる指摘はありませんでした。原文と根拠の確認は引き続き必要です。',
      ),
    );
  for (const f of check.result.findings) {
    const card = el('section', undefined, 'finding ' + f.severity);
    card.append(
      el(
        'strong',
        (f.severity === 'warning' ? '要確認' : '編集のヒント') +
          ' ・ ' +
          categories[f.category],
      ),
    );
    if (f.quote) card.append(el('blockquote', f.quote));
    card.append(el('p', f.reason), el('p', '修正案: ' + f.suggestion));
    $('check-result').append(card);
  }
  if (check.result.questions.length) {
    $('check-result').append(el('h3', '原文で確認すること'));
    const ul = el('ul');
    for (const q of check.result.questions) ul.append(el('li', q));
    $('check-result').append(ul);
  }
}
function renderSummary() {
  const target = $('ai-result');
  target.replaceChildren();
  target.append(el('p', current.summary || 'まだ要約がありません。'));
  const ul = el('ul');
  for (const point of current.key_points) ul.append(el('li', point));
  target.append(ul);
  const chips = el('div', undefined, 'chips');
  for (const tag of current.ai_tags)
    chips.append(el('span', tag, 'badge'));
  target.append(chips);
  if (current.ai_tags.length) {
    const b = el('button', 'タグの提案を編集欄に入れる', 'secondary');
    b.onclick = () => {
      if (current.status !== 'pending_review') return;
      $('editor').elements.tags.value = current.ai_tags.join(', ');
      markDirty();
      switchPanel('edit');
      $('message').textContent =
        'タグを編集欄に入れました。内容を確認して保存してください。';
    };
    b.id='apply-ai-tags';
    b.disabled = current.status !== 'pending_review';
    target.append(b);
  }
}
async function openArticle(id) {
  const data = await api('articles/' + encodeURIComponent(id));
  current = data.article;
  dirty = false;
  $('confirm').checked = false;
  $('detail').hidden = false;
  $('empty-detail').hidden = true;
  $('detail-title').textContent = current.title;
  $('article-state').textContent =
    states[current.status] +
    ' ・ 要約とタグ: ' +
    (states[current.ai_status] || current.ai_status);
  for (const name of [
    'title',
    'category',
    'excerpt',
    'body_markdown',
    'ai_check_notes',
  ])
    $('editor').elements[name].value = current[name];
  $('editor').elements.tags.value = current.tags.join(', ');
  $('editor').elements.citations.value = current.citations.join('\n');
  $('preview').innerHTML = data.preview_html;
  $('preview-note').textContent = '保存済みの本文です。';
  renderCheck(data.check);
  renderSummary();
  $('flags').replaceChildren(
    ...data.review_flags.map((f) => el('li', f)),
  );
  $('citations').replaceChildren();
  for (const url of current.citations) {
    const li = el('li'),
      a = el('a', url);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.append(a);
    $('citations').append(li);
  }
  $('sources').replaceChildren();
  for (const source of data.sources) {
    const d = el('details'),
      link = el('a', '素材の出典を開く');
    link.href = source.source_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    d.append(
      el('summary', source.title + ' — ' + source.author),
      link,
      el('pre', source.raw_summary),
    );
    $('sources').append(d);
  }
  const actions = {
    submitted: '確認待ちに登録',
    edited: '記事を編集',
    published: '公開を承認',
    rejected: '却下',
    ai_check_requested: 'AIチェックを依頼',
  };
  $('history').replaceChildren();
  for (const event of [...data.events].reverse()) {
    const row = el('div', undefined, 'history-row');
    row.append(
      el('strong', actions[event.action] || event.action),
      el(
        'p',
        event.actor +
          ' ・ 版 ' +
          event.revision +
          ' ・ ' +
          date(event.created_at),
        'hint',
      ),
    );
    $('history').append(row);
  }
  $('versions').replaceChildren();
  $('version-preview').hidden = true;
  for (const v of data.versions) {
    const b = el(
      'button',
      '版 ' + v.revision + ' ・ ' + date(v.created_at),
      'version-button secondary',
    );
    b.onclick = () =>
      action(async () => {
        const d = await api(
          'articles/' + current.id + '/versions/' + v.revision,
        );
        $('version-preview').hidden = false;
        $('version-preview').replaceChildren(el('h3', d.version.title));
        const content = el('div');
        content.innerHTML = d.preview_html;
        $('version-preview').append(
          content,
          el('p', 'この版は閲覧専用です。', 'hint'),
        );
      });
    $('versions').append(b);
  }
  $('publication-state').textContent = data.publication
    ? states[data.publication.state] || data.publication.state
    : 'まだ公開承認されていません。';
  $('retry-build').hidden =
    identity.role !== 'admin' ||
    !data.publication ||
    data.publication.state === 'deployed';
  $('articles')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('selected', b.dataset.id === id));
  updateActions();
}
async function switchPanel(name) {
  for (const b of document.querySelectorAll('[role="tab"]')) {
    const active = b.dataset.panel === name;
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
    $('panel-' + b.dataset.panel).hidden = !active;
  }
  if (name === 'preview' && current && dirty) {
    await action(async () => {
      const data = await api('preview', 'POST', {
        body_markdown: $('editor').elements.body_markdown.value,
      });
      $('preview').innerHTML = data.preview_html;
      $('preview-note').textContent =
        '未保存の本文のプレビューです。保存はまだしていません。';
    });
  }
}
async function members() {
  const data = await api('editors');
  $('members').replaceChildren();
  for (const email of data.admins)
    $('members').append(el('p', email + ' ・ 管理者', 'hint'));
  for (const member of data.editors) {
    const row = el('div', undefined, 'member-row');
    const b = el(
      'button',
      member.active ? '利用を停止' : '利用を再開',
      'secondary',
    );
    b.onclick = () =>
      action(async () => {
        await api('editors', 'POST', {
          email: member.email,
          active: !member.active,
        });
        await members();
        return '権限を更新しました。Cloudflare Accessの許可メールも合わせて更新してください。';
      });
    row.append(
      el(
        'span',
        member.email + ' ・ ' + (member.active ? '利用中' : '停止中'),
      ),
      b,
    );
    $('members').append(row);
  }
}
async function operations() {
  const data = await api('operations');
  const root = $('operations');
  root.replaceChildren();
  root.append(
    el(
      'p',
      '今日のAI呼び出し: ' +
        (data.usage?.calls || 0) +
        ' / ' +
        data.settings.dailyCalls +
        '回 ・ 予約トークン: ' +
        (data.usage?.tokens_reserved || 0).toLocaleString() +
        ' / ' +
        data.settings.dailyTokens.toLocaleString(),
      'notice',
    ),
  );
  for (const job of data.jobs) {
    const row = el('div', undefined, 'history-row');
    row.append(
      el(
        'p',
        (job.entity_type === 'article' ? '記事' : '素材') +
          ' ・ ' +
          (states[job.state] || job.state) +
          (job.error_code
            ? ' ・ ' +
              (failures[job.error_code] ||
                '設定または入力を確認してください。')
            : ''),
      ),
    );
    if (job.state === 'failed') {
      const b = el('button', '再試行', 'secondary');
      b.onclick = () =>
        action(async () => {
          await api('jobs/' + job.id + '/retry', 'POST');
          await operations();
        });
      row.append(b);
    }
    root.append(row);
  }
  root.append(el('h3', '監視するチャンネル'));
  for (const channel of data.channels) {
    const row = el('div', undefined, 'member-row'),
      b = el(
        'button',
        channel.enabled ? '監視を停止' : '監視を開始',
        'secondary',
      );
    row.append(el('span', channel.title), b);
    b.onclick = () =>
      action(async () => {
        await api('channels/' + channel.id, 'PATCH', {
          enabled: !channel.enabled,
        });
        await operations();
      });
    root.append(row);
  }
  const add = el('button', 'チャンネルを追加', 'secondary');
  add.onclick = () => {
    const handle = prompt(
      'YouTubeのハンドルを入力してください（例：@EGA.channel）',
    );
    if (handle)
      action(async () => {
        await api('channels', 'POST', { handle });
        await operations();
      });
  };
  root.append(add);
}
async function refresh() {
  if (
    dirty &&
    !confirm(
      '未保存の修正があります。修正を破棄して最新版を読み込みますか？',
    )
  )
    return '再読み込みを中止しました。';
  await list();
  if (identity.role === 'admin') {
    await operations();
    await members();
  }
  if (current) await openArticle(current.id);
}
document
  .querySelectorAll('#editor input,#editor textarea,#editor select')
  .forEach((f) => f.addEventListener('input', markDirty));
document.querySelectorAll('[role="tab"]').forEach((b) => {
  b.onclick = () => switchPanel(b.dataset.panel);
  b.onkeydown = (e) => {
    const tabs = [...document.querySelectorAll('[role="tab"]')],
      index = tabs.indexOf(b);
    let next;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft')
      next = (index + tabs.length - 1) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      tabs[next].focus();
      switchPanel(tabs[next].dataset.panel);
    }
  };
});
$('editor').onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    const f = $('editor').elements;
    await api('articles/' + current.id, 'PATCH', {
      revision: current.revision,
      title: f.title.value,
      body_markdown: f.body_markdown.value,
      excerpt: f.excerpt.value,
      category: f.category.value,
      tags: f.tags.value
        .split(/[,、]/)
        .map((s) => s.trim())
        .filter(Boolean),
      citations: f.citations.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      ai_check_notes: f.ai_check_notes.value,
    });
    dirty = false;
    await list();
    await openArticle(current.id);
    return '保存しました。本文が変わった場合は要約・タグを処理し、AIチェックもやり直してください。';
  });
};
$('confirm').onchange = updateActions;
for (const status of ['published', 'rejected'])
  $(status === 'published' ? 'publish' : 'reject').onclick = () =>
    action(async () => {
      if (dirty) throw new Error('修正を保存してから審査してください。');
      if (
        !confirm(
          status === 'published'
            ? 'この版の記事を公開承認しますか？'
            : 'この記事を却下しますか？',
        )
      )
        return '操作を中止しました。';
      await api('articles/' + current.id + '/review', 'POST', {
        status,
        revision: current.revision,
        confirmed: $('confirm').checked,
      });
      await list();
      await openArticle(current.id);
      return status === 'published'
        ? '公開を承認しました。変更履歴の「公開の反映状況」を確認してください。'
        : '却下しました。';
    });
function jobMessage(result) {
  const failed = result.jobs.find((j) =>
    ['failed', 'deferred'].includes(j.state),
  );
  return failed
    ? failures[failed.code] ||
        'AI処理を完了できませんでした。状態を確認してから再試行してください。'
    : result.jobs.length
      ? '処理しました。結果を確認してください。'
      : '処理は待機中、または既に完了しています。';
}
$('ai-check').onclick = () =>
  action(async () => {
    if (dirty)
      throw new Error('修正を保存してからチェックしてください。');
    const queued = await api(
      'articles/' + current.id + '/ai-check',
      'POST',
      {
        revision: current.revision,
      },
    );
    let message = '同じ内容のチェック結果を再利用しました。';
    if (!queued.cached)
      message = jobMessage(
        await api('articles/' + current.id + '/ai-run', 'POST', {
          revision: current.revision,
          kind: 'review',
        }),
      );
    await openArticle(current.id);
    return message;
  });
$('ai-enrich').onclick = () =>
  action(async () => {
    const result = await api(
      'articles/' + current.id + '/ai-run',
      'POST',
      {
        revision: current.revision,
        kind: 'enrich',
      },
    );
    await list();
    await openArticle(current.id);
    return jobMessage(result);
  });
$('discover').onclick = () =>
  action(async () => {
    const result = await api('youtube/discover', 'POST');
    await refresh();
    return result.state === 'waiting'
      ? 'YouTube APIキーの設定が必要です。'
      : '動画を確認しました。';
  });
$('process').onclick = () =>
  action(async () => {
    const result = await api('jobs/run', 'POST');
    await refresh();
    return jobMessage(result);
  });
$('refresh').onclick = () => action(refresh);
$('more').onclick = () => action(() => list(true));
$('article-search').oninput = filterList;
let previousStatus = $('status').value;
$('status').onchange = () => {
  if (
    dirty &&
    !confirm('未保存の修正があります。一覧を切り替えますか？')
  ) {
    $('status').value = previousStatus;
    return;
  }
  previousStatus = $('status').value;
  current = null;
  dirty = false;
  $('detail').hidden = true;
  $('empty-detail').hidden = false;
  action(() => list());
};
$('retry-build').onclick = () =>
  action(async () => {
    await api('articles/' + current.id + '/retry-build', 'POST');
    await openArticle(current.id);
  });
$('member-form').onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    await api('editors', 'POST', {
      email: $('member-email').value,
      active: true,
    });
    $('member-email').value = '';
    await members();
    return '編集者を追加しました。Cloudflare AccessのAllowポリシーにも同じメールを追加してください。';
  });
};
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});
action(async () => {
  identity = await api('me');
  $('identity').textContent =
    identity.email +
    ' ・ ' +
    (identity.role === 'admin' ? '管理者' : '編集者');
  $('owner-tools').hidden = identity.role !== 'admin';
  $('team-tools').hidden = identity.role !== 'admin';
  await refresh();
  return '記事を選んで編集・確認を始めてください。';
});
