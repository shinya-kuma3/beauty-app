const $ = (id) => document.getElementById(id);
let current = null,
  nextOffset = null,
  dirty = false;
const messages = {
  unauthorized: '認証が必要です。',
  admin_access_required: '管理者としてログインしてください。',
  revision_conflict: '別の更新が入りました。再読み込みして確認してください。',
  ai_processing_incomplete: 'AI処理の完了後に公開できます。',
  independent_citation_required:
    'X・YouTube以外の参考資料も追加して確認してください。',
  rejected_source: '却下された素材が含まれています。',
  invalid_input: '入力内容を確認してください。',
  youtube_discovery_failed:
    '動画を取得できませんでした。YouTube APIの設定と制限を確認してください。',
  database_not_configured: 'データベースの設定が必要です。',
};
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/admin/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('管理者ログインまたはサーバーの設定を確認してください。');
  }
  if (!response.ok)
    throw new Error(
      messages[data.error?.code] ||
        '処理できませんでした。入力と設定を確認してください。',
    );
  return data;
}
async function action(task) {
  $('message').textContent = '処理しています…';
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  try {
    await task();
    $('message').textContent = '完了しました。';
  } catch (error) {
    $('message').textContent = error.message;
  } finally {
    for (const b of document.querySelectorAll('button')) b.disabled = false;
    updateActions();
  }
}
const states = {
  queued: '処理待ち',
  waiting: '次回の処理待ち',
  failed: '処理に失敗',
  complete: '処理済み',
  pending_review: '確認待ち',
  published: '公開承認済み',
  rejected: '却下',
  building: 'サイトへ反映中',
  deployed: 'サイトへ反映済み',
  waiting_configuration: '公開設定待ち',
};
function updateActions() {
  if (!current) return;
  const editable = current.status === 'pending_review';
  for (const field of $('editor').elements) field.disabled = !editable;
  const confirmed = $('confirm').checked;
  $('publish').disabled =
    !editable || current.ai_status !== 'complete' || !confirmed || dirty;
  $('reject').disabled = !editable || !confirmed || dirty;
  $('review-actions').hidden = !editable;
}
async function list(append = false) {
  const data = await api(
    `articles?status=${$('status').value}&offset=${append ? nextOffset : 0}`,
  );
  if (!append) $('articles').replaceChildren();
  for (const row of data.articles) {
    const button = document.createElement('button');
    button.className = 'article-item';
    const title = document.createElement('strong');
    title.textContent = row.title;
    const status = document.createElement('small');
    status.textContent = states[row.ai_status] || row.ai_status;
    button.append(title, status);
    button.addEventListener('click', () => {
      if (dirty && !confirm('未保存の修正があります。記事を切り替えますか？'))
        return;
      action(() => open(row.id));
    });
    $('articles').append(button);
  }
  nextOffset = data.next_offset;
  $('more').hidden = nextOffset === null;
  if (!data.articles.length && !append)
    $('articles').textContent = 'この状態の記事はありません。';
}
async function open(id) {
  const data = await api(`articles/${encodeURIComponent(id)}`);
  current = data.article;
  dirty = false;
  $('confirm').checked = false;
  $('detail').hidden = false;
  $('detail-title').textContent = current.title;
  $('article-state').textContent =
    `${states[current.status]} ・ ${states[current.ai_status] || current.ai_status}`;
  for (const field of [
    'title',
    'category',
    'excerpt',
    'body_markdown',
    'ai_check_notes',
  ])
    $('editor').elements[field].value = current[field];
  $('editor').elements.tags.value = current.tags.join(', ');
  $('editor').elements.citations.value = current.citations.join('\n');
  $('preview').innerHTML = data.preview_html;
  $('ai-result').textContent = JSON.stringify(
    {
      要約: current.summary,
      要点: current.key_points,
      タグの提案: current.ai_tags,
    },
    null,
    2,
  );
  $('flags').replaceChildren();
  for (const flag of data.review_flags) {
    const li = document.createElement('li');
    li.textContent = flag;
    $('flags').append(li);
  }
  $('citations').replaceChildren();
  for (const url of current.citations) {
    const li = document.createElement('li'),
      a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = url;
    li.append(a);
    $('citations').append(li);
  }
  $('sources').replaceChildren();
  for (const source of data.sources) {
    const details = document.createElement('details'),
      heading = document.createElement('summary'),
      text = document.createElement('pre'),
      link = document.createElement('a');
    heading.textContent = `${source.title} — ${source.author}`;
    text.textContent = source.raw_summary;
    link.href = source.source_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '素材の出典を開く';
    details.append(heading, link, text);
    $('sources').append(details);
  }
  $('history').textContent = JSON.stringify(
    {
      審査履歴: data.events,
      公開反映: data.publication
        ? {
            状態: states[data.publication.state] || data.publication.state,
            ビルドID: data.publication.build_id,
          }
        : null,
    },
    null,
    2,
  );
  $('retry-build').hidden =
    !data.publication || data.publication.state === 'deployed';
  updateActions();
}
async function operations() {
  const data = await api('operations');
  $('operations').replaceChildren();
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(
    {
      今日の呼び出しと予約トークン: data.usage,
      処理待ち: data.jobs,
      素材: data.sources,
      利用記録: data.calls,
    },
    null,
    2,
  );
  $('operations').append(pre);
  for (const job of data.jobs.filter((j) => j.state === 'failed')) {
    const button = document.createElement('button');
    button.textContent = `失敗した処理を再試行（${job.id.slice(0, 8)}）`;
    button.onclick = () =>
      action(async () => {
        await api(`jobs/${job.id}/retry`, 'POST');
        await operations();
      });
    $('operations').append(button);
  }
  const channelTitle = document.createElement('h3');
  channelTitle.textContent = '監視するチャンネル';
  $('operations').append(channelTitle);
  for (const channel of data.channels) {
    const row = document.createElement('p'),
      button = document.createElement('button');
    row.textContent = channel.title + ' ';
    button.textContent = channel.enabled ? '監視を停止' : '監視を開始';
    button.onclick = () =>
      action(async () => {
        await api(`channels/${channel.id}`, 'PATCH', {
          enabled: !channel.enabled,
        });
        await operations();
      });
    row.append(button);
    $('operations').append(row);
  }
  const add = document.createElement('button');
  add.textContent = 'チャンネルを追加';
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
  $('operations').append(add);
}
async function refresh() {
  if (dirty && !confirm('未保存の修正があります。再読み込みしますか？'))
    throw new Error('再読み込みを中止しました。');
  await list();
  await operations();
  if (current) await open(current.id);
}
document
  .querySelectorAll('#editor input,#editor textarea,#editor select')
  .forEach((field) =>
    field.addEventListener('input', () => {
      dirty = true;
      updateActions();
    }),
  );
$('editor').addEventListener('submit', (event) => {
  event.preventDefault();
  action(async () => {
    const f = $('editor').elements;
    const body = {
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
    };
    await api(`articles/${current.id}`, 'PATCH', body);
    dirty = false;
    await refresh();
  });
});
$('confirm').addEventListener('change', updateActions);
for (const status of ['published', 'rejected'])
  $(status === 'published' ? 'publish' : 'reject').onclick = () =>
    action(async () => {
      if (dirty) throw new Error('修正を保存してから審査してください。');
      await api(`articles/${current.id}/review`, 'POST', {
        status,
        revision: current.revision,
        confirmed: $('confirm').checked,
      });
      await refresh();
    });
$('discover').onclick = () =>
  action(async () => {
    const result = await api('youtube/discover', 'POST');
    if (result.state === 'waiting')
      throw new Error('YouTube APIキーを設定してください。');
    await refresh();
  });
$('process').onclick = () =>
  action(async () => {
    await api('jobs/run', 'POST');
    await refresh();
  });
$('refresh').onclick = () => action(refresh);
$('status').onchange = () => action(() => list());
$('more').onclick = () => action(() => list(true));
$('retry-build').onclick = () =>
  action(async () => {
    await api(`articles/${current.id}/retry-build`, 'POST');
    await refresh();
  });
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
  }
});
action(refresh);
