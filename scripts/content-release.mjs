import {syncWithdrawals} from './withdrawal-release.mjs';
import {visibilityPath,validateAppend} from '../shared/withdrawal-content.mjs';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  digest,
  parseSnapshot,
  snapshotPath,
} from '../shared/release-content.mjs';
export const repository = 'shinya-kuma3/beauty-app';
export function gitBlobSha(content) {
  const bytes = Buffer.from(content);
  return createHash('sha1')
    .update('blob ' + bytes.length + String.fromCharCode(0))
    .update(bytes)
    .digest('hex');
}
export function validateFile(file) {
  const prefix = 'src/content/approved-articles/';
  if (
    !file.path?.startsWith(prefix) ||
    snapshotPath(file.path.slice(prefix.length, -5)) !== file.path
  )
    throw Error('Only approved article JSON files may be written');
  const article = parseSnapshot(file.content);
  if (
    article.dbId !== file.article_id ||
    article.reviewRevision !== file.revision
  )
    throw Error('Article approval identity mismatch');
  return article;
}
export function validateHook(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.cloudflare.com' ||
    url.username ||
    url.password ||
    !/^\/client\/v4\/workers\/builds\/deploy_hooks\/[0-9a-f-]+$/i.test(
      url.pathname,
    ) ||
    url.search ||
    url.hash
  )
    throw Error('Production deploy hook is invalid');
  return url;
}
export class GitHub {
  constructor(token, fetchFn = fetch) {
    this.token = token;
    this.fetchFn = fetchFn;
  }
  async api(path, method = 'GET', body) {
    const response = await this.fetchFn(
      'https://api.github.com/repos/' + repository + path,
      {
        method,
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + this.token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw Error(
        'GitHub request failed (' +
          response.status +
          '); check Actions permissions and branch protection',
      );
    return response.status === 204 ? null : response.json();
  }
  async head(branch) {
    if (!['main', 'develop'].includes(branch))
      throw Error('Unsupported branch');
    const ref = await this.api('/git/ref/heads/' + branch);
    const commit = await this.api('/git/commits/' + ref.object.sha);
    return { sha: ref.object.sha, tree: commit.tree.sha };
  }
  async snapshots(head) {
    const data = await this.api(
      '/git/trees/' + head.tree + '?recursive=1',
    );
    if (data.truncated) throw Error('Git tree truncated');
    return new Map(
      data.tree
        .filter(
          (entry) =>
            entry.path.startsWith('src/content/approved-articles/') &&
            entry.path.endsWith('.json'),
        )
        .map((entry) => {
          if (entry.type !== 'blob' || entry.mode !== '100644')
            throw Error('Approved article must be a regular JSON file');
          return [entry.path, entry];
        }),
    );
  }
  async content(entry) {
    if (!entry) return null;
    const blob = await this.api('/git/blobs/' + entry.sha);
    if (blob.encoding !== 'base64')
      throw Error('Unexpected Git encoding');
    return Buffer.from(
      blob.content.replace(/\s/g, ''),
      'base64',
    ).toString('utf8');
  }
  async visibility(head){const data=await this.api('/git/trees/'+head.tree+'?recursive=1');if(data.truncated)throw Error('Git tree truncated');const entry=data.tree.find(row=>row.path===visibilityPath);if(entry&&(entry.type!=='blob'||entry.mode!=='100644'))throw Error('Visibility must be a regular JSON file');return this.content(entry);}
  async commitVisibility(branch,head,content){
   validateAppend(await this.visibility(head),content);
   if((await this.head(branch)).sha!==head.sha)throw Error('Branch changed; retry');
   const blob=await this.api('/git/blobs','POST',{content:Buffer.from(content).toString('base64'),encoding:'base64'});
   const tree=await this.api('/git/trees','POST',{base_tree:head.tree,tree:[{path:visibilityPath,mode:'100644',type:'blob',sha:blob.sha}]});
   const commit=await this.api('/git/commits','POST',{message:'Apply human-approved article withdrawals',tree:tree.sha,parents:[head.sha]});
   await this.api('/git/refs/heads/'+branch,'PATCH',{sha:commit.sha,force:false});return {sha:commit.sha,tree:tree.sha};
  }
  async commit(branch, head, files) {
    if (!files.length) return head;
    for (const file of files) {
      validateFile(file);
      if ((await digest(file.content)) !== file.sha)
        throw Error('Article hash mismatch');
    }
    if ((await this.head(branch)).sha !== head.sha)
      throw Error('Branch changed; retry the next run');
    const tree = [];
    for (const file of files) {
      const blob = await this.api('/git/blobs', 'POST', {
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64',
      });
      tree.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }
    const next = await this.api('/git/trees', 'POST', {
      base_tree: head.tree,
      tree,
    });
    const commit = await this.api('/git/commits', 'POST', {
      message:
        branch === 'main'
          ? 'Publish Grok-checked approved articles'
          : 'Sync human-approved articles for review',
      tree: next.sha,
      parents: [head.sha],
    });
    await this.api('/git/refs/heads/' + branch, 'PATCH', {
      sha: commit.sha,
      force: false,
    });
    return { sha: commit.sha, tree: next.sha };
  }
}
export class ReleaseClient {
  constructor(url, key, fetchFn = fetch) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== '/'
    )
      throw Error('Content API must be an HTTPS origin');
    this.url = parsed.origin;
    this.key = key;
    this.fetchFn = fetchFn;
  }
  async api(path, method = 'GET', body) {
    const response = await this.fetchFn(
      this.url + '/api/release/' + path,
      {
        method,
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + this.key,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw Error(
        'Release API failed (' +
          response.status +
          '); approval or configuration is required',
      );
    return response.json();
  }
  async files() {
    let cursor = '',
      files = [],
      seen = new Set();
    do {
      const data = await this.api(
        'articles' +
          (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      );
      for (const file of data.files) {
        validateFile(file);
        if (
          (await digest(file.content)) !== file.sha ||
          seen.has(file.path)
        )
          throw Error('Invalid or duplicate approved snapshot');
        seen.add(file.path);
        files.push(file);
      }
      cursor = data.next_cursor;
      if (files.length > 10000)
        throw Error('Approved snapshot limit reached');
    } while (cursor);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }
}
export async function triggerProduction(hook, fetchFn = fetch) {
  const response = await fetchFn(validateHook(hook), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error('Production build hook failed (' + response.status + ')');
  const data = await response.json();
  if (
    !data.success ||
    !/^[0-9a-f-]{36}$/i.test(data.result?.build_uuid || '')
  )
    throw Error('Production build hook did not return a build ID');
  return data.result.build_uuid;
}
export async function syncAndRelease({
  github,
  release,
  verify,
  trigger,
}) {
  let main = await github.head('main'),
    mainFiles = await github.snapshots(main),
    develop = await github.head('develop'),
    developFiles = await github.snapshots(develop);
  const files = await release.files();
  const updates = files
    .filter(
      (file) =>
        developFiles.get(file.path)?.sha !== gitBlobSha(file.content),
    )
    .slice(0, 20);
  if (updates.length) {
    develop = await github.commit('develop', develop, updates);
    developFiles = await github.snapshots(develop);
  }
  const recover = await release.api('reconcile');
  for (const row of recover.releases) {
    if (row.main_base_sha === main.sha) continue;
    if (
      row.files.every(
        (file) =>
          mainFiles.get(file.path)?.sha === gitBlobSha(file.content),
      )
    ) {
      await release.api('requests/' + row.id + '/published', 'POST', {
        digest: row.digest,
        main_base_sha: row.main_base_sha,
        main_sha: main.sha,
      });
    }
  }
  const builds = await release.api('builds');
  for (const row of builds.releases) {
    const build = await trigger();
    await release.api('requests/' + row.id + '/build', 'POST', {
      main_sha: row.main_sha,
      build_id: build,
    });
  }
  const candidates = files
    .filter(
      (file) =>
        developFiles.get(file.path)?.sha === gitBlobSha(file.content) &&
        mainFiles.get(file.path)?.sha !== gitBlobSha(file.content),
    )
    .slice(0, 5);
  if (!candidates.length)
    return { state: 'up_to_date', synced: updates.length };
  const changes = [];
  for (const file of candidates)
    changes.push({
      article_id: file.article_id,
      revision: file.revision,
      after_sha: file.sha,
      before_content: await github.content(mainFiles.get(file.path)),
    });
  const check = await release.api('requests', 'POST', {
    main_base_sha: main.sha,
    develop_sha: develop.sha,
    changes,
  });
  const reviewed = await release.api('requests/' + check.id);
  if (reviewed.state !== 'approved')
    return {
      state: reviewed.state === 'rejected' ? 'blocked' : 'waiting_grok',
      release_id: check.id,
      synced: updates.length,
    };
  if (
    reviewed.digest !== check.digest ||
    reviewed.main_base_sha !== main.sha ||
    reviewed.develop_sha !== develop.sha
  )
    throw Error('Grok result belongs to another revision');
  await verify(candidates, main.sha);
  const fresh = await release.api('requests/' + check.id);
  if (fresh.state !== 'approved' || fresh.digest !== check.digest)
    throw Error('Grok approval changed during validation');
  if ((await github.head('develop')).sha !== develop.sha)
    throw Error('Develop changed during validation; retry');
  main = await github.commit('main', main, candidates);
  await release.api('requests/' + check.id + '/published', 'POST', {
    digest: check.digest,
    main_base_sha: reviewed.main_base_sha,
    main_sha: main.sha,
  });
  const build = await trigger();
  await release.api('requests/' + check.id + '/build', 'POST', {
    main_sha: main.sha,
    build_id: build,
  });
  return {
    state: 'building',
    main_sha: main.sha,
    release_id: check.id,
    synced: updates.length,
  };
}
export async function verifyCandidate(
  files,
  mainSha,
  root = process.cwd(),
) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (head.status || head.stdout.trim() !== mainSha)
    throw Error('Validation checkout is not the current trusted main');
  const originals = new Set(
    (await readdir(resolve(root, 'src/content/articles'))).map((f) =>
      f.replace(/\.json$/, ''),
    ),
  );
  for (const file of files) {
    validateFile(file);
    const slug = file.path.split('/').at(-1).slice(0, -5);
    if (originals.has(slug))
      throw Error('Approved slug collides with an existing article');
    const target = resolve(root, file.path);
    if (
      relative(
        resolve(root, 'src/content/approved-articles'),
        target,
      ).startsWith('..')
    )
      throw Error('Invalid snapshot target');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  const env = {
    ...process.env,
    CONTENT_MODE: 'git',
    CONTENT_PIPELINE_ENABLED: 'false',
    WORKERS_CI_BRANCH: 'main',
  };
  for (const key of [
    'GITHUB_TOKEN',
    'RELEASE_API_KEY',
    'CLOUDFLARE_PRODUCTION_DEPLOY_HOOK',
    'CONTENT_EXPORT_KEY',
    'INGEST_API_KEY',
  ])
    delete env[key];
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const script of [
    'check',
    'test',
    'build',
    'test:build',
    'build:mens',
    'test:subdomains',
  ]) {
    const result = spawnSync(npm, ['run', script], {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) throw Error('Validation failed: ' + script);
  }
}
export async function main() {
  const env = process.env;
  if (
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== 'refs/heads/main'
  )
    throw Error('Run this workflow from the trusted main branch');
  if (
    !env.RELEASE_API_KEY ||
    !env.CLOUDFLARE_PRODUCTION_DEPLOY_HOOK ||
    !env.GITHUB_TOKEN
  ) {
    console.log(
      'Publication paused: configure RELEASE_API_KEY and CLOUDFLARE_PRODUCTION_DEPLOY_HOOK in Actions Secrets.',
    );
    return;
  }
  validateHook(env.CLOUDFLARE_PRODUCTION_DEPLOY_HOOK);
  const services = {
    github: new GitHub(env.GITHUB_TOKEN),
    release: new ReleaseClient(
      env.CONTENT_RELEASE_API_URL ||
        'https://codex-content-review-pipeline-beauty-app.sinyak4649.workers.dev/',
      env.RELEASE_API_KEY,
    ),
    verify: verifyCandidate,
    trigger: () =>
      triggerProduction(env.CLOUDFLARE_PRODUCTION_DEPLOY_HOOK),
  };
  const withdrawal=await syncWithdrawals({...services,verify:async(content,sha)=>{await writeFile(resolve('src/content/withdrawn-articles.json'),content);await verifyCandidate([],sha);}});
  const result=withdrawal.changed?withdrawal:await syncAndRelease(services);
  console.log(JSON.stringify(result));
  if (env.GITHUB_STEP_SUMMARY)
    await writeFile(
      env.GITHUB_STEP_SUMMARY,
      'Article publication: ' + result.state + '\n',
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
