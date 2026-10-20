import {parseVisibility} from '../shared/withdrawal-content.mjs';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  unlink,
} from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { z } from 'zod';
import {
  exportedArticle,
  toStaticArticle,
  parseSnapshot,
  digest,
} from '../shared/release-content.mjs';
export {
  exportedArticle,
  toStaticArticle,
} from '../shared/release-content.mjs';
export async function exportContent(
  env = process.env,
  root = process.cwd(),
) {
  let visibility={version:1,withdrawals:[]};try{visibility=parseVisibility(await readFile(resolve(root,'src/content/withdrawn-articles.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const hidden=new Set(visibility.withdrawals.map(row=>row.slug));
  const folder = resolve(root, 'src/content/generated-articles');
  await mkdir(folder, { recursive: true });
  for (const name of await readdir(folder)) {
    if (!/^[a-z0-9-]+\.json$/.test(name))
      throw new Error('Unexpected generated file');
    const path = resolve(folder, name);
    if (relative(folder, path).startsWith('..'))
      throw new Error('Invalid generated path');
    await unlink(path);
  }
  let rows = [];
  const expected =
    env.WORKERS_CI_BRANCH && env.WORKERS_CI_BRANCH !== 'main'
      ? 'development'
      : env.CONTENT_ENV || 'production';
  const live =
    env.CONTENT_PIPELINE_ENABLED === 'true' &&
    env.WORKERS_CI_BRANCH !== 'main' &&
    env.CONTENT_MODE !== 'git';
  if (live) {
    if (!env.CONTENT_API_URL || !env.CONTENT_EXPORT_KEY)
      throw new Error('Content export URL and key must be configured');
    const url = new URL('/api/published/export', env.CONTENT_API_URL);
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      )
    )
      throw new Error('Invalid content API URL');
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.CONTENT_EXPORT_KEY}`,
        'X-Content-Environment': expected,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Content export failed (${response.status})`);
    const data = await response.json();
    if (data.environment !== expected)
      throw new Error('Content database environment mismatch');
    rows = z.array(exportedArticle).parse(data.articles);
  }
  const committed = [];
  if (!live) {
    const path = resolve(root, 'src/content/approved-articles');
    let names = [];
    try {
      names = await readdir(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const name of names) {
      if (name === '.gitkeep') continue;
      if (!/^[a-z0-9-]+\.json$/.test(name))
        throw Error('Unexpected approved file');
      const content = await readFile(resolve(path, name), 'utf8'),
        article = parseSnapshot(content);
      committed.push({
        slug: name.slice(0, -5),
        original_slug: article.originalSlug,
        id: article.dbId,
        revision: article.reviewRevision,
        sha: await digest(content),
      });
    }
  }
  const originals = new Set(
    (await readdir(resolve(root, 'src/content/articles'))).map((f) =>
      f.replace(/\.json$/, ''),
    ),
  );
  const seen = new Set();
  for (const row of committed) {
    if ((originals.has(row.slug) && row.original_slug!==row.slug) || (row.original_slug && (!originals.has(row.slug) || row.original_slug!==row.slug)) || seen.has(row.slug))
      throw Error(`Article slug collision: ${row.slug}`);
    seen.add(row.slug);
  }
  for (const row of rows) {
    if ((originals.has(row.slug) && row.original_slug!==row.slug) || (row.original_slug && (!originals.has(row.slug) || row.original_slug!==row.slug)) || seen.has(row.slug))
      throw new Error(`Article slug collision: ${row.slug}`);
    seen.add(row.slug);
    await writeFile(
      resolve(folder, `${row.slug}.json`),
      JSON.stringify(toStaticArticle(row), null, 2) + '\n',
    );
  }
  await mkdir(resolve(root, 'public'), { recursive: true });
  await writeFile(
    resolve(root, 'public/content-manifest.json'),
    JSON.stringify({
      environment: expected,
      withdrawals: visibility.withdrawals,
      articles: live
        ? rows.filter(row=>!hidden.has(row.slug)).map((row) => ({ id: row.id, revision: row.revision, ...(row.original_slug?{original_slug:row.original_slug}:{}) }))
        : committed.filter(row=>!hidden.has(row.slug)).map(({ id, revision, sha, original_slug }) => ({
            ...(original_slug?{original_slug}:{}),
            id,
            revision,
            sha,
          })),
    }),
  );
  return live ? rows.length : committed.length;
}
