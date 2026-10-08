import { mkdir, readdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { z } from 'zod';
export const exportedArticle = z
  .object({
    id: z.uuid(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    title: z.string().min(1).max(120),
    body_markdown: z.string().min(40).max(50000),
    excerpt: z.string().min(1).max(300),
    category: z.enum(['skin', 'hair', 'nail', 'body']),
    tags: z.array(z.string().min(1).max(30)).max(5),
    citations: z
      .array(z.url().refine((v) => new URL(v).protocol === 'https:'))
      .min(1)
      .max(20),
    updated_at: z.iso.datetime(),
    published_at: z.iso.datetime(),
    revision: z.number().int().positive(),
  })
  .strict();
export function toStaticArticle(row) {
  return {
    title: row.title,
    summary: row.excerpt,
    category: row.category,
    tags: row.tags,
    status: 'published',
    updatedAt: row.updated_at.slice(0, 10),
    sections: [{ heading: '記事本文', body: row.body_markdown }],
    sources: row.citations.map((url) => ({
      title: new URL(url).hostname,
      url,
      kind: 'reference',
    })),
    readingMinutes: Math.min(
      60,
      Math.max(1, Math.ceil(row.body_markdown.length / 500)),
    ),
    relatedIngredients: [],
    bodyMarkdown: row.body_markdown,
    aiAssisted: true,
    dbId: row.id,
    reviewRevision: row.revision,
  };
}
export async function exportContent(env = process.env, root = process.cwd()) {
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
  if (env.CONTENT_PIPELINE_ENABLED === 'true') {
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
  const originals = new Set(
    (await readdir(resolve(root, 'src/content/articles'))).map((f) =>
      f.replace(/\.json$/, ''),
    ),
  );
  const seen = new Set();
  for (const row of rows) {
    if (originals.has(row.slug) || seen.has(row.slug))
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
      articles: rows.map((row) => ({ id: row.id, revision: row.revision })),
    }),
  );
  return rows.length;
}
