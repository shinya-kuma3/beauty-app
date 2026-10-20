import { ApiError, hash, now, parse, reviewFlags } from './core.mjs';
import { grokResultSchema, reviewInput } from './review.mjs';
export async function sourcesFor(db, id) {
  return (
    await db
      .prepare(
        'SELECT s.* FROM sources s JOIN article_sources r ON r.source_id=s.id WHERE r.article_id=? ORDER BY s.id',
      )
      .bind(id)
      .all()
  ).results;
}
export async function latestCheck(env, row, sources) {
  const input = await reviewInput(env, row, sources);
  const check = await env.DB.prepare(
    "SELECT * FROM article_checks WHERE article_id=? AND provider='grok' ORDER BY (content_hash=?) DESC,created_at DESC,id DESC LIMIT 1",
  )
    .bind(row.id, input.content_hash)
    .first();
  if (!check) return null;
  return {
    id: check.id,
    revision: check.revision,
    state: check.state,
    requested_by: check.requested_by,
    created_at: check.created_at,
    completed_at: check.completed_at,
    model: 'Grok Bot（外部）',
    result: check.result ? JSON.parse(check.result) : null,
    body_chars: check.body_chars,
    reviewed_chars: check.reviewed_chars,
    stale:
      check.content_hash !== input.content_hash ||
      (check.state === 'pending' && check.revision !== row.revision) ||
      (check.state === 'complete' &&
        check.ai_check_notes !== row.ai_check_notes),
  };
}
export async function requestCheck(env, id, revision, actor) {
  const row = await env.DB.prepare(
    "SELECT * FROM articles WHERE id=? AND revision=? AND status='pending_review'",
  )
    .bind(id, revision)
    .first();
  if (!row) throw new ApiError(409, 'revision_conflict');
  const input = await reviewInput(env, row, await sourcesFor(env.DB, id));
  const existing = await env.DB.prepare(
    "SELECT * FROM article_checks WHERE article_id=? AND content_hash=? AND provider='grok'",
  )
    .bind(id, input.content_hash)
    .first();
  if (existing?.result && existing.ai_check_notes === row.ai_check_notes)
    return { id: existing.id, state: 'complete', cached: true };
  const idCheck = crypto.randomUUID(),
    time = now();
  const mutation = existing?.id ?? idCheck;
  const statements = [
    env.DB.prepare(
      "INSERT OR IGNORE INTO article_checks(id,article_id,content_hash,revision,input_text,body_chars,reviewed_chars,requested_by,created_at,provider,state) SELECT ?,id,?,revision,?,?,?,?,?,'grok','pending' FROM articles WHERE id=? AND revision=? AND status='pending_review'",
    ).bind(
      idCheck,
      input.content_hash,
      input.input_text,
      input.body_chars,
      input.reviewed_chars,
      actor,
      time,
      id,
      revision,
    ),
    env.DB.prepare(
      "UPDATE article_checks SET state='pending',revision=?,input_text=?,requested_by=?,created_at=?,result=NULL,model=NULL,completed_at=NULL,response_hash=NULL,completed_revision=NULL,ai_check_notes=NULL WHERE id=? AND provider='grok' AND EXISTS(SELECT 1 FROM articles WHERE id=? AND revision=? AND status='pending_review') AND (state!='pending' OR revision!=?)",
    ).bind(
      revision,
      input.input_text,
      actor,
      time,
      mutation,
      id,
      revision,
      revision,
    ),
    env.DB.prepare(
      "INSERT INTO review_events(article_id,actor,action,revision,created_at) SELECT article_id,?,'grok_check_requested',revision,? FROM article_checks WHERE id=? AND requested_by=? AND created_at=? AND state='pending'",
    ).bind(actor, time, mutation, actor, time),
  ];
  await env.DB.batch(statements);
  const after = await env.DB.prepare(
    "SELECT id,state FROM article_checks WHERE article_id=? AND content_hash=? AND revision=? AND provider='grok'",
  )
    .bind(id, input.content_hash, revision)
    .first();
  if (!after) throw new ApiError(409, 'revision_conflict');
  return after;
}
export async function pendingChecks(env, limit = 1, filter = {}) {
  // Inspect a small candidate window to skip stale inputs, but return only one job.
  const checkId = filter.id ?? null;
  const articleId = filter.article_id ?? null;
  await env.DB.prepare(
    "UPDATE article_checks SET state='obsolete' WHERE provider='grok' AND state='pending' AND NOT EXISTS(SELECT 1 FROM articles a WHERE a.id=article_id AND a.status='pending_review' AND a.revision=article_checks.revision) AND (? IS NULL OR id=?) AND (? IS NULL OR article_id=?)",
  )
    .bind(checkId, checkId, articleId, articleId)
    .run();
  const rows = (
    await env.DB.prepare(
      "SELECT c.* FROM article_checks c WHERE provider='grok' AND state='pending' AND (? IS NULL OR c.id=?) AND (? IS NULL OR c.article_id=?) ORDER BY created_at,id LIMIT ?",
    )
      .bind(checkId, checkId, articleId, articleId, checkId ? 1 : 10)
      .all()
  ).results;
  const requests = [];
  for (const check of rows) {
    const row = await env.DB.prepare("SELECT * FROM articles WHERE id=?")
      .bind(check.article_id)
      .first();
    const input = await reviewInput(env, row, await sourcesFor(env.DB, row.id));
    if (input.content_hash !== check.content_hash) {
      await env.DB.prepare(
        "UPDATE article_checks SET state='obsolete' WHERE id=? AND state='pending'",
      )
        .bind(check.id)
        .run();
      continue;
    }
    requests.push({
      id: check.id,
      article_id: check.article_id,
      revision: check.revision,
      content_hash: check.content_hash,
      scope: "single_article",
      request_endpoint: "/api/ingest/checks/" + check.id,
      result_endpoint: "/api/ingest/checks/" + check.id + "/result",
      article: JSON.parse(check.input_text),
      instructions:
        "この依頼のarticle_idとrevisionで指定した1記事だけを確認してください。他の記事や依頼をまとめて確認せず、全記事一覧の取得・再審査は行わないでください。結果はこの依頼のresult_endpointだけに返してください。美容の話題、使い方、商品紹介、体験談を扱う記事として、読みやすさ・表記・素材との意味の相違・PR表示を確認してください。論文や科学的根拠の提示・裏付けは掲載条件ではなく、それらがないことを指摘や公開停止の理由にしないでください。参考にしたX・YouTubeのURLは残し、論文・科学的根拠へのリンクは記事に含めないでください。元資料にない事実や体験は創作しないでください。日本語の確認メモと指摘を返し、専門用語には原語を残してください。記事の公開・削除・本文編集はできません。",
    });
    break;
  }
  return { requests, scope: "single_article", max_per_poll: 1 };
}
export async function completeCheck(env, id, body) {
  const data = parse(grokResultSchema, body),
    responseHash = await hash(JSON.stringify(data));
  const check = await env.DB.prepare(
    "SELECT * FROM article_checks WHERE id=? AND provider='grok'",
  )
    .bind(id)
    .first();
  if (!check) throw new ApiError(404, 'check_not_found');
  if (check.state === 'complete') {
    if (check.response_hash === responseHash)
      return { id, state: 'complete', cached: true };
    throw new ApiError(409, 'check_already_completed');
  }
  const row = await env.DB.prepare('SELECT * FROM articles WHERE id=?')
    .bind(check.article_id)
    .first();
  if (
    check.state !== 'pending' ||
    !row ||
    row.status !== 'pending_review' ||
    row.revision !== check.revision ||
    data.revision !== check.revision
  )
    throw new ApiError(409, 'check_obsolete');
  if (
    (await reviewInput(env, row, await sourcesFor(env.DB, row.id)))
      .content_hash !== check.content_hash
  )
    throw new ApiError(409, 'check_obsolete');
  const allowed = JSON.parse(row.citations);
  if (data.checked_citations.some((url) => !allowed.includes(url)))
    throw new ApiError(400, 'invalid_checked_citation');
  const { revision, ai_check_notes, ...result } = data;
  const notes =
    ai_check_notes.split('\n\n[サイトの確認事項]')[0] +
    '\n\n[サイトの確認事項]\n' +
    reviewFlags(row).join('\n');
  const time = now(),
    mutation = crypto.randomUUID();
  const out = await env.DB.batch([
    env.DB.prepare(
      "UPDATE articles SET ai_check_notes=?,revision=revision+1,updated_at=?,mutation_token=? WHERE id=? AND revision=? AND status='pending_review' AND EXISTS(SELECT 1 FROM article_checks WHERE id=? AND state='pending')",
    ).bind(notes, time, mutation, row.id, check.revision, check.id),
    env.DB.prepare(
      "UPDATE article_checks SET state='complete',result=?,model='external-grok-bot',completed_at=?,completed_revision=?,response_hash=?,ai_check_notes=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM articles WHERE id=? AND mutation_token=?)",
    ).bind(
      JSON.stringify(result),
      time,
      check.revision + 1,
      responseHash,
      notes,
      check.id,
      row.id,
      mutation,
    ),
    env.DB.prepare(
      "INSERT INTO review_events(article_id,actor,action,revision,created_at) SELECT id,'grok-bot','grok_check_completed',revision,? FROM articles WHERE id=? AND mutation_token=?",
    ).bind(time, row.id, mutation),
  ]);
  if (!out[0].meta.changes) throw new ApiError(409, 'check_obsolete');
  return { id, state: 'complete', revision: check.revision + 1 };
}
