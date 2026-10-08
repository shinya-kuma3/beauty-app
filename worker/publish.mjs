import { now } from './core.mjs';
export async function triggerBuild(env, job) {
  if (!env.CONTENT_DEPLOY_HOOK) {
    await env.DB.prepare(
      "UPDATE publication_jobs SET state='waiting_configuration',error_code='deploy_hook_missing',updated_at=? WHERE id=?",
    )
      .bind(now(), job.id)
      .run();
    return { state: 'waiting_configuration' };
  }
  try {
    const hook = new URL(env.CONTENT_DEPLOY_HOOK);
    if (
      hook.protocol !== 'https:' ||
      hook.hostname !== 'api.cloudflare.com' ||
      !hook.pathname.startsWith('/client/v4/workers/builds/deploy_hooks/')
    )
      throw new Error('invalid_hook');
    const response = await fetch(hook, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.result?.build_uuid)
      throw new Error('build_trigger_failed');
    await env.DB.prepare(
      "UPDATE publication_jobs SET state='building',build_id=?,attempts=attempts+1,error_code=NULL,updated_at=? WHERE id=?",
    )
      .bind(result.result.build_uuid, now(), job.id)
      .run();
    return { state: 'building' };
  } catch {
    await env.DB.prepare(
      "UPDATE publication_jobs SET state='failed',attempts=attempts+1,error_code='build_trigger_failed',updated_at=? WHERE id=?",
    )
      .bind(now(), job.id)
      .run();
    return { state: 'failed' };
  }
}
export async function monitorBuilds(env) {
  if (!env.ASSETS) return;
  const response = await env.ASSETS.fetch(
    new Request('https://assets.internal/content-manifest.json'),
  );
  if (!response.ok) return;
  let manifest;
  try {
    manifest = await response.json();
  } catch {
    return;
  }
  if (
    manifest.environment !== env.PIPELINE_ENV ||
    !Array.isArray(manifest.articles)
  )
    return;
  const jobs = (
    await env.DB.prepare(
      "SELECT p.id,a.id AS article_id,a.revision FROM publication_jobs p JOIN articles a ON a.id=p.article_id WHERE p.state!='deployed' LIMIT 100",
    ).all()
  ).results;
  const ready = jobs
    .filter((job) =>
      manifest.articles.some(
        (a) => a.id === job.article_id && a.revision === job.revision,
      ),
    )
    .slice(0, 50);
  if (ready.length)
    await env.DB.prepare(
      `UPDATE publication_jobs SET state='deployed',error_code=NULL,updated_at=? WHERE id IN (${ready.map(() => '?').join(',')})`,
    )
      .bind(now(), ...ready.map((job) => job.id))
      .run();
}
