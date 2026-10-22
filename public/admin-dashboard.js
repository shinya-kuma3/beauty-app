const $ = (id) => document.getElementById(id);
let currentCheck = null;
// A proposal read from a file or pasted text; it never leaves the browser until the editor saves.
let manualProposal = null;
let current = null,
  nextCursor = null,
  total = 0,
  appliedFilters = new URLSearchParams({
    status: 'pending_review',
    keyword_mode: 'all',
  }),
  tagPicker = null,
  dirty = false,
  busy = false,
  identity = null,
  listed = [];
const states = {
  pending: 'Grok Botの取得・返信待ち',
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
  waiting_github_sync: 'GitHubのdevelop同期待ち',
  waiting_grok_release: '本番差分のGrok確認待ち',
  waiting_main_push: 'main反映待ち',
  release_blocked: 'Grokの指摘で本番反映を停止',
  waiting_static_build: '本番の静的ビルド待ち',
  building: 'サイトへ反映中',
  deployed: 'サイトへ反映済み',
  waiting_configuration: '公開設定待ち',
};
const messages = {
  proposal_obsolete: '本文または確認結果が更新されています。一覧を更新して、最新の修正案と比較してください。',
  article_withdrawn: '非公開依頼済みの記事は、再公開できません。',
  unauthorized: '認証が必要です。',
  admin_access_required: '許可されたアカウントでログインしてください。',
  owner_required: 'この操作は管理者だけが行えます。',
  revision_conflict:
    '別の人またはAIによる更新が入りました。入力内容は残しています。必要な修正を控えてから「一覧を更新」で最新版を確認してください。',
  ai_processing_incomplete:
    '要約・タグの処理が終わってから公開できます。',
  rejected_source: '却下された素材が含まれています。',
  invalid_input: '入力内容を確認してください。',
  rate_limited:
    '操作の回数制限に達しました。少し待ってから再試行してください。',
  youtube_discovery_failed:
    '動画を取得できませんでした。YouTube APIの設定と制限を確認してください。',
  editor_must_be_inactive: '削除する前に編集者の利用を停止してください。',
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
      data.error?.message ||
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
    .forEach((f) => { if (!f.closest('#feedback-tools,#publication-tools,#withdraw-dialog,#billing-tools,#health-tools')) f.disabled = true; });
  $('message').textContent = '処理しています…';
  document.querySelectorAll('button').forEach((b) => { if (!b.closest('#feedback-tools,#publication-tools,#withdraw-dialog,#billing-tools,#health-tools')) b.disabled = true; });
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
      .forEach((f) => { if (!f.closest('#feedback-tools,#publication-tools,#withdraw-dialog,#billing-tools,#health-tools')) f.disabled = false; });
    document
      .querySelectorAll('button')
      .forEach((b) => { if (!b.closest('#feedback-tools,#publication-tools,#withdraw-dialog,#billing-tools,#health-tools')) b.disabled = false; });
    updateActions();
  }
}
function updateActions() {
  if (!current) return;
  document.querySelectorAll('[data-proposal-decision]').forEach(button=>{button.disabled=busy||dirty||current.status!=='pending_review'||!currentCheck||currentCheck.stale||!!currentCheck.proposal_decision;});
  $('start-revision').hidden = current.status !== 'published';
  $('start-revision').disabled = busy;
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
  $('open-preview').disabled = busy;
  document.querySelectorAll('[data-manual-decision]').forEach((button) => {
    button.disabled =
      busy || (button.dataset.manualDecision === 'accepted' && !editable);
  });
  const applyTags = $('apply-ai-tags');
  if (applyTags) applyTags.disabled = busy || !editable;
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
function readFilters() {
  const params = new URLSearchParams();
  // action() disables the fields before executing a task; read values directly.
  for (const field of $('article-filters').elements) {
    if (
      !field.name ||
      !field.value ||
      (field.type === 'checkbox' && !field.checked)
    )
      continue;
    if (field.name === 'selected_tags') {
      for (const tag of tagPicker.getSelected())
        params.append('tag', tag);
    } else params.append(field.name, field.value.trim());
  }
  return params;
}
async function applySearch() {
  const candidate = readFilters();
  await list(false, candidate);
  appliedFilters = candidate;
  return '検索しました。編集中の記事はそのまま残しています。';
}
async function loadFilters() {
  const data = await api('article-filters');
  tagPicker.setTags(data.tags);
}
async function list(append = false, filters = appliedFilters) {
  const params = new URLSearchParams(filters);
  if (append && nextCursor) params.set('cursor', nextCursor);
  const data = await api('articles?' + params);
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
      el(
        'small',
        ({ skin: '肌', hair: '髪', nail: '爪', body: '身体' }[
          row.category
        ] || '') +
          ' ・ ' +
          states[row.status] +
          ' ・ ' +
          states[row.ai_status],
      ),
      el(
        'small',
        { created: '登録', updated: '更新', published: '公開承認' }[
          filters.get('date_basis') || 'created'
        ] +
          '：' +
          date(
            row[
              {
                created: 'created_at',
                updated: 'updated_at',
                published: 'published_at',
              }[filters.get('date_basis') || 'created']
            ],
          ),
      ),
      el('small', (row.tags || []).join(' / ')),
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
    setRecheckState(row.id, !!row.recheck_pending);
  }
  nextCursor = data.next_cursor ?? null;
  if (!append) total = data.total ?? listed.length;
  $('more').hidden = nextCursor === null;
  if (!listed.length)
    $('articles').append(
      el(
        'p',
        '条件に一致する記事はありません。条件を変えて検索してください。',
        'hint',
      ),
    );
  $('article-count').textContent =
    total + '件中 ' + listed.length + '件表示';
}
function setRecheckState(id, pending) {
  const row = listed.find(row => row.id === id);
  if (row) row.recheck_pending = pending;
  const button = [...$('articles').querySelectorAll('.article-item')].find(button => button.dataset.id === id);
  if (!button) return;
  button.classList.toggle('rechecking', !!pending);
  const old = button.querySelector('.recheck-status');
  if (pending && !old) button.append(el('span', 'Grok再チェック中', 'recheck-status'));
  if (!pending && old) old.remove();
}
function renderProposal(check) {
  const proposal = check.result?.proposed_body_markdown;
  if (!proposal) {
    if (check.state === 'complete')
      $('check-result').append(
        el(
          'p',
          '本文の修正案はありません。確認メモをもとに必要な箇所を編集してください。',
          'hint',
        ),
      );
    return;
  }
  const panel = el('section', undefined, 'proposal-panel');
  panel.id = 'proposal-comparison';
  panel.append(
    el('h3', '本文の変更を比較する'),
    el(
      'p',
      '赤い行は削除・変更される部分、緑の行は追加・変更案です。採用しても、公開の承認まではサイトの本文は変わりません。',
      'hint',
    ),
  );
  panel.append(
    BeautyArticleDiff.render(document, current.body_markdown, proposal),
  );
  if (check.proposal_decision)
    panel.append(
      el(
        'p',
        (check.proposal_decision === 'accepted'
          ? '変更を採用しました'
          : '変更しないを選びました') +
          ' ・ ' +
          date(check.decided_at) +
          ' ・ ' +
          check.decided_by,
        'proposal-decision',
      ),
    );
  else {
    if (check.stale)
      panel.append(
        el(
          'p',
          '依頼後に記事が更新されています。この修正案は採用できません。再チェックを依頼してください。',
          'hint',
        ),
      );
    const tools = el('div', undefined, 'tools');
    for (const [decision, label] of [
      ['accepted', '変更を採用する'],
      ['declined', '変更しない'],
    ]) {
      const button = el(
        'button',
        label,
        decision === 'declined' ? 'secondary' : undefined,
      );
      button.type = 'button';
      button.dataset.proposalDecision = decision;
      button.onclick = () => {
        if (busy || dirty || check.stale || current.status !== 'pending_review')
          return;
        const id = current.id,
          revision = current.revision;
        if (
          !confirm(
            decision === 'accepted'
              ? 'Grokの修正案に本文を差し替えます。公開は別途承認が必要です。採用しますか？'
              : '現在の本文を残し、この修正案を見送りますか？',
          )
        )
          return;
        action(async () => {
          await api(
            'articles/' + id + '/checks/' + check.id + '/decision',
            'POST',
            { revision, decision },
          );
          await list();
          await openArticle(id);
          switchPanel('ai');
          return decision === 'accepted'
            ? '修正案を採用しました。要約・タグの処理と本文を確認してから公開してください。'
            : '本文を変更せず、修正案を見送りました。';
        });
      };
      tools.append(button);
    }
    panel.append(tools);
  }
  $('check-result').append(panel);
}

function renderCheck(check) {
  currentCheck=check;
  $('check-result').replaceChildren();
  if (current) setRecheckState(current.id, !!check && check.state === 'pending' && !check.stale);
  if (!check) {
    $('check-state').textContent =
      'Grok Botの再チェック依頼はまだありません。現在の信頼性メモは編集欄で確認できます。';
    return;
  }
  $('check-state').textContent =
    (check.stale && !check.proposal_decision
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
  if (check.state === 'pending' && !check.stale && current) {
    const target = current;
    const requestUrl = location.origin + '/api/ingest/checks/' + check.id;
    const note = el('div', undefined, 'notice single-recheck');
    note.append(el('strong', '対象は「' + target.title + '」の1記事だけです。'), el('p', 'Botはこの依頼URLから対象記事だけを取得します。複数の記事をまとめた再チェックではありません。'));
    const instruction = 'この記事だけを再チェックしてください。\n記事：' + target.title + '\n記事ID：' + target.id + '\nGET ' + requestUrl + '\n既存のINGEST_API_KEYで認証してください。キーは返信に含めず、返されたrequest.articleだけを確認し、同じ依頼のresult_endpointへ結果を返してください。他の記事の取得や一括再チェックは行わないでください。';
    const copy = el('button', 'この記事だけの依頼文をコピー', 'secondary');
    copy.type = 'button';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(instruction); copy.textContent = 'コピーしました'; }
      catch { copy.textContent = '下の依頼文を選択してコピーしてください'; }
    };
    const details = el('details'); details.append(el('summary', 'Botに渡す依頼文'), el('pre', instruction));
    note.append(copy, details); $('check-result').append(note);
  }
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
        '文字をGrok Botへの依頼に含めました。以下はBotが返した確認結果です。編集者も原文を確認してください。',
    ),
    el('p', date(check.completed_at) + ' ・ ' + check.model, 'hint'),
  );
  $('check-result').append(scope, el('p', check.result.overview));
  renderProposal(check);
  for (const [label, value] of [
    ['参考情報の補足', check.result.primary_source_notes],
    ['PR・利益相反', check.result.pr_notes],
  ])
    if (value) $('check-result').append(el('h3', label), el('p', value));
  if (check.result.terms?.length) {
    $('check-result').append(el('h3', '専門用語の原語'));
    for (const term of check.result.terms)
      $('check-result').append(
        el(
          'p',
          term.japanese +
            ' / ' +
            term.original +
            '（' +
            term.language +
            '）',
        ),
      );
  }

  const categories = {
    claim: '断定表現',
    evidence: '参考情報',
    wording: '表記',
    consistency: '整合性',
  };
  if (!check.result.findings.length)
    $('check-result').append(
      el(
        'p',
        'AIによる指摘はありませんでした。記事全体の読みやすさや紹介内容を確認してください。',
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
    b.id = 'apply-ai-tags';
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
  if (manualProposal && manualProposal.articleId !== current.id)
    resetManualProposal();
  else renderManualProposal();
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
  $('related-results').replaceChildren();
  $('sources').replaceChildren();
  for (const source of data.sources) {
    const d = el('details'),
      link = el('a', '参考にした投稿・動画を開く');
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
    ai_check_requested: '以前のAIチェックを依頼',
    grok_check_requested: 'Grok Botに再チェックを依頼',
    grok_check_completed: 'Grok Botの確認結果を受け取り',
    grok_proposal_accepted: 'Grokの修正案を採用',
    grok_proposal_declined: 'Grokの修正案を見送り',
    initial_revision_started: '初期記事の改訂を開始',
    revision_started: '公開記事の改訂を開始',
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
  syncArticleUrl(id);
  updateActions();
}
// Keep /admin/articles/<id> in the address bar so an article can be reopened or shared with the team.
function syncArticleUrl(id) {
  if (window.BeautyAdminNav?.current?.() !== 'articles') return;
  const path = '/admin/articles/' + encodeURIComponent(id);
  if (location.pathname !== path) history.replaceState(null, '', path);
}
function articleFromPath() {
  const match = /^\/admin\/articles\/([^/]+)$/.exec(location.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
async function switchPanel(name) {
  for (const b of document.querySelectorAll('[role="tab"]')) {
    const active = b.dataset.panel === name;
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
    $('panel-' + b.dataset.panel).hidden = !active;
  }
  if (name === 'ai') renderManualProposal();
}
async function members() {
  const data = await api('editors');
  $('members').replaceChildren();
  for (const email of data.admins)
    $('members').append(el('p', email + ' ・ 管理者', 'hint'));
  for (const member of data.editors) {
    const row = el(
      'div',
      undefined,
      'member-row' + (member.active ? '' : ' inactive'),
    );
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
    const actions = el('div', undefined, 'member-actions');
    const memberInfo = el('span', undefined, 'member-info');
    memberInfo.append(
      el('span', member.email),
      el(
        'span',
        member.active ? '利用中' : '停止中',
        'member-status ' + (member.active ? 'active' : 'inactive'),
      ),
    );
    row.append(memberInfo, actions);
    if (!member.active) {
      const remove = el('button', '削除', 'danger');
      remove.onclick = () => {
        if (
          !confirm(
            member.email +
              ' を編集者一覧から削除しますか？このメールでサイトの操作はできなくなります。過去の審査履歴は残ります。',
          )
        )
          return;
        action(async () => {
          await api('editors', 'DELETE', { email: member.email });
          await members();
          return '編集者を削除しました。Cloudflare Accessの許可メールからも削除してください。';
        });
      };
      actions.append(remove);
    }
    actions.append(b);
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
  await loadFilters();
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
    await loadFilters();
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
    if (dirty) throw new Error('修正を保存してから依頼してください。');
    const { id, revision } = current;
    const result = await api(
      'articles/' + encodeURIComponent(id) + '/ai-check',
      'POST',
      { revision },
    );
    await openArticle(id);
    return result.cached
      ? '同じ内容のGrok Botの結果を再利用しました。'
      : 'Grok Botへの依頼を、この1記事だけで登録しました。Botが取得・返信すると結果が表示されます。';
  });
$('related').onclick = () =>
  action(async () => {
    const data = await api('articles/' + current.id + '/related');
    $('related-results').replaceChildren();
    for (const a of data.articles) {
      const button = el('button', a.title, 'secondary');
      button.onclick = () => {
        if (
          dirty &&
          !confirm('未保存の変更があります。この記事を開きますか？')
        )
          return;
        action(() => openArticle(a.id));
      };
      $('related-results').append(
        button,
        el('p', a.tags.join(' / '), 'hint'),
      );
    }
    if (!data.articles.length)
      $('related-results').append(
        el(
          'p',
          '比較できる公開承認済み記事の埋め込みがまだありません。',
          'hint',
        ),
      );
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
$('article-filters').onsubmit = (e) => {
  e.preventDefault();
  action(applySearch);
};
$('reset-search').onclick = () => {
  $('article-filters').reset();
  tagPicker.setSelected([]);
  previousStatus = $('status').value;
  action(applySearch);
};
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
  action(applySearch);
};
$('start-revision').onclick = () => {
  if (
    !confirm(
      '公開中の記事を残したまま、改訂版を作成しますか？改訂版は再び公開承認とGrokの本番差分確認が必要です。',
    )
  )
    return;
  action(async () => {
    await api('articles/' + current.id + '/revise', 'POST', {
      revision: current.revision,
    });
    await list();
    await openArticle(current.id);switchPanel('edit');
    return '改訂版を作成しました。現在の公開記事は、新しい版の審査が完了するまでそのままです。';
  });
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
const categoryLabels = {
  skin: 'スキンケア',
  hair: 'ヘアケア',
  nail: '爪ケア',
  body: 'ボディケア',
};
const tokyoDate = (value = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })
    .format(value)
    .replaceAll('-', '.');
function editorValues() {
  const f = $('editor').elements;
  return {
    title: f.title.value.trim(),
    excerpt: f.excerpt.value.trim(),
    category: f.category.value,
    tags: f.tags.value
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter(Boolean),
    citations: f.citations.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    body_markdown: f.body_markdown.value,
  };
}
async function openPublicPreview() {
  if (!current) return;
  const values = editorValues();
  const data = await api('public-preview', 'POST', {
    body_markdown: values.body_markdown,
    citations: values.citations,
  });
  const page = el('article', undefined, 'public-preview-article');
  // A div, not <header>: the admin stylesheet lays out every <header> as the page bar.
  const header = el('div', undefined, 'pp-header');
  const meta = el('div', undefined, 'pp-meta');
  const published = current.status === 'published' && !dirty;
  meta.append(
    el('span', categoryLabels[values.category] || ''),
    el('span', data.reading_minutes + '分で読む'),
    el(
      'span',
      '更新日：' +
        (published
          ? (current.display_updated_at || current.updated_at || '')
              .slice(0, 10)
              .replaceAll('-', '.')
          : tokyoDate() + '（公開を承認した日になります）'),
    ),
  );
  const tags = el('div', undefined, 'pp-tags');
  for (const tag of values.tags) tags.append(el('span', '# ' + tag));
  header.append(
    el('p', 'CARE JOURNAL', 'pp-eyebrow'),
    el('h1', values.title || '（タイトル未入力）'),
    meta,
    el('p', values.excerpt || '（紹介文未入力）', 'pp-excerpt'),
    tags,
  );
  const note = el('aside', undefined, 'pp-note');
  note.append(
    el('p', 'この記事はAIの補助を使って作成し、編集者が内容を確認しています。'),
  );
  const body = el('div', undefined, 'pp-body');
  // body_html comes from the server-side public renderer (html disabled, safe links only).
  body.innerHTML = data.body_html;
  body.querySelectorAll('a').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  page.append(header, body);
  if (data.references.length) {
    const sources = el('aside', undefined, 'pp-sources');
    const accordion = el('details', undefined, 'pp-sources-accordion');
    const summary = el('summary');
    summary.append(
      el('h2', '参考にした投稿・動画'),
      el('span', data.references.length + '件', 'pp-sources-count'),
    );
    const list = el('ul');
    for (const source of data.references) {
      const li = el('li'),
        a = el('a', source.title + ' ↗');
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.append(a, el('small', '参考にした情報 · 外部サイトを開きます'));
      list.append(li);
    }
    accordion.append(
      summary,
      list,
      el(
        'p',
        '※ 投稿・動画は、投稿者による削除や非公開への変更などにより、リンク先を表示できない場合があります。',
        'pp-sources-caution',
      ),
    );
    sources.append(accordion);
    page.append(sources);
  }
  if (data.hidden_references)
    page.append(
      el(
        'p',
        '参考URLのうち' +
          data.hidden_references +
          '件は、論文・医学資料などのため公開サイトには表示されません。',
        'hint pp-hidden',
      ),
    );
  page.append(note);
  $('article-preview-page').replaceChildren(page);
  $('article-preview-note').textContent = dirty
    ? '未保存の変更を含むプレビューです。公開する前に「修正を保存」を押してください。'
    : current.status === 'pending_review'
      ? '保存済みの内容です。公開を承認すると、この内容でサイトに表示されます。'
      : '保存済みの内容です。';
  const dialog = $('article-preview-dialog');
  if (!dialog.open) dialog.showModal();
  $('article-preview-close').focus();
  return 'プレビューを表示しました。';
}
$('open-preview').onclick = () => action(openPublicPreview);
$('article-preview-close').onclick = () => $('article-preview-dialog').close();
$('article-preview-dialog').addEventListener('click', (event) => {
  if (event.target === $('article-preview-dialog'))
    $('article-preview-dialog').close();
});

function resetManualProposal() {
  manualProposal = null;
  $('manual-proposal-file').value = '';
  $('manual-proposal-text').value = '';
  $('manual-proposal-result').replaceChildren();
}
function normalizeProposal(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}
async function readProposalFile(file) {
  if (!/\.(md|markdown|txt)$/i.test(file.name))
    throw new Error('.md または .txt のファイルを選んでください。');
  if (file.size > 400000)
    throw new Error('ファイルが大きすぎます。本文は50,000文字までです。');
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(
      '文字を読み取れませんでした。UTF-8で保存したファイルを選んでください。',
    );
  }
}
function renderManualProposal() {
  const root = $('manual-proposal-result');
  root.replaceChildren();
  if (!manualProposal || !current || manualProposal.articleId !== current.id)
    return;
  const before = $('editor').elements.body_markdown.value;
  manualProposal.before = before;
  root.append(
    el(
      'p',
      '読み込んだ内容：' +
        manualProposal.label +
        '（' +
        manualProposal.text.length.toLocaleString() +
        '文字）',
      'hint',
    ),
  );
  if (before === manualProposal.text) {
    root.append(
      el('p', '公開予定の本文と同じ内容です。変更はありません。', 'hint'),
    );
    return;
  }
  root.append(
    el(
      'p',
      '赤い行は削除・変更される部分、緑の行は追加・変更案です。左は編集欄にある公開予定の本文です。',
      'hint',
    ),
  );
  const firstLine = manualProposal.text.split('\n').find((line) => line.trim());
  if (firstLine && /^#\s/.test(firstLine))
    root.append(
      el(
        'p',
        '1行目がタイトル（# 〜）になっています。本文に不要な場合は、採用後に編集欄で削除してください。',
        'manual-proposal-warning',
      ),
    );
  root.append(
    BeautyArticleDiff.render(document, before, manualProposal.text, [
      '公開予定の本文',
      '読み込んだ修正案',
    ]),
  );
  if (current.status !== 'pending_review')
    root.append(
      el(
        'p',
        '公開中の記事に採用するには、先に「この記事を編集する」で改訂を始めてください。',
        'hint',
      ),
    );
  const tools = el('div', undefined, 'tools');
  for (const [decision, label] of [
    ['accepted', '変更を採用する'],
    ['declined', '変更しない'],
  ]) {
    const button = el(
      'button',
      label,
      decision === 'declined' ? 'secondary' : undefined,
    );
    button.type = 'button';
    button.dataset.manualDecision = decision;
    button.onclick = () => decideManualProposal(decision);
    tools.append(button);
  }
  root.append(tools);
  updateActions();
}
function decideManualProposal(decision) {
  if (busy || !manualProposal || !current) return;
  if (decision === 'declined') {
    resetManualProposal();
    $('manual-proposal-message').textContent =
      '修正案を取り消しました。本文は変更していません。';
    return;
  }
  if (current.status !== 'pending_review' || manualProposal.articleId !== current.id)
    return;
  const body = $('editor').elements.body_markdown;
  if (body.value !== manualProposal.before) {
    renderManualProposal();
    $('manual-proposal-message').textContent =
      '比較した後に本文が変わりました。最新の本文で比較し直したので、もう一度確認してください。';
    return;
  }
  if (
    !confirm(
      '編集欄の本文を、読み込んだ修正案に置き換えます。「修正を保存」を押すまで記事には反映されず、公開には別途承認が必要です。置き換えますか？',
    )
  )
    return;
  body.value = manualProposal.text;
  resetManualProposal();
  markDirty();
  switchPanel('edit');
  $('manual-proposal-message').textContent = '';
  $('message').textContent =
    '本文を修正案に置き換えました。内容を確認して「修正を保存」を押してください。公開は別途承認が必要です。';
}
$('manual-proposal-compare').onclick = () =>
  action(async () => {
    if (!current) throw new Error('先に記事を選んでください。');
    const file = $('manual-proposal-file').files?.[0];
    const pasted = $('manual-proposal-text').value;
    if (file && pasted.trim())
      throw new Error(
        'ファイルと貼り付けの両方が入っています。どちらか一方にしてください。',
      );
    let text, label;
    if (file) {
      text = await readProposalFile(file);
      label = file.name;
    } else if (pasted.trim()) {
      text = pasted;
      label = '貼り付けた本文';
    } else
      throw new Error(
        '修正案のファイルを選ぶか、本文を貼り付けてください。',
      );
    text = normalizeProposal(text);
    if (text.trim().length < 40)
      throw new Error('修正案の本文が短すぎます。40文字以上にしてください。');
    if (text.length > 50000)
      throw new Error('修正案の本文が50,000文字を超えています。');
    manualProposal = { articleId: current.id, text, label, before: '' };
    $('manual-proposal-message').textContent = '';
    renderManualProposal();
    return '修正案を読み込みました。左右の内容を確認してください。';
  });
$('manual-proposal-clear').onclick = () => {
  if (busy) return;
  resetManualProposal();
  $('manual-proposal-message').textContent = '読み込みを取り消しました。';
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
  tagPicker = BeautyTagPicker.create($('admin-tags'));
  await refresh();
  const linked = articleFromPath();
  if (linked) {
    try {
      await openArticle(linked);
    } catch {
      return '指定された記事を開けませんでした。一覧から選んでください。';
    }
  }
  return '記事を選んで編集・確認を始めてください。';
});

window.addEventListener('edit-publication',event=>{
 if(busy) return;
 if(dirty&&!confirm('未保存の変更があります。公開記事の編集へ移動しますか？')) return;
 action(async()=>{
  const result=await api('publications/edit','POST',event.detail);
  window.BeautyAdminNav?.go('/admin/articles/'+encodeURIComponent(result.id));
  dirty=false;$('article-filters').reset();tagPicker.setSelected([]);$('status').value='pending_review';previousStatus='pending_review';appliedFilters=new URLSearchParams({status:'pending_review',keyword_mode:'all'});
  await list();await openArticle(result.id);switchPanel('edit');$('detail').scrollIntoView?.({behavior:'smooth',block:'start'});
  return '編集できます。再公開が完了するまで、現在の公開記事はそのまま残ります。';
 });
});
