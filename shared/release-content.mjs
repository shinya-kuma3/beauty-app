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
      .max(20)
      .default([]),
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

export const staticArticleSchema = z
  .object({
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(300),
    category: z.enum(['skin', 'hair', 'nail', 'body']),
    tags: z.array(z.string().min(1).max(30)).max(5),
    status: z.literal('published'),
    updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sections: z
      .array(z.object({ heading: z.string(), body: z.string() }).strict())
      .min(1),
    sources: z
      .array(
        z
          .object({
            title: z.string(),
            url: z.url().refine((v) => new URL(v).protocol === 'https:'),
            kind: z.literal('reference'),
          })
          .strict(),
      )
      .default([]),
    readingMinutes: z.number().int().min(1).max(60),
    relatedIngredients: z.array(z.string()),
    bodyMarkdown: z.string().min(40).max(50000),
    aiAssisted: z.literal(true),
    dbId: z.uuid(),
    reviewRevision: z.number().int().positive(),
  })
  .strict();
export const snapshotPath = (slug) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)
    throw Error('invalid_snapshot_path');
  return 'src/content/approved-articles/' + slug + '.json';
};
export async function digest(value) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function articleFile(raw) {
  const row = exportedArticle.parse(raw);
  const content = JSON.stringify(toStaticArticle(row), null, 2) + '\n';
  return {
    article_id: row.id,
    revision: row.revision,
    path: snapshotPath(row.slug),
    content,
    sha: await digest(content),
  };
}
export function parseSnapshot(content) {
  if (new TextEncoder().encode(content).length > 400000)
    throw Error('snapshot_too_large');
  const row = staticArticleSchema.parse(JSON.parse(content));
  if (
    row.sections.length !== 1 ||
    row.sections[0].heading !== '記事本文' ||
    row.sections[0].body !== row.bodyMarkdown
  )
    throw Error('snapshot_body_mismatch');
  return row;
}
export async function releaseDigest(mainSha, developSha, changes) {
  return digest(
    JSON.stringify([
      'content-release-v1',
      mainSha,
      developSha,
      changes
        .map((c) => ({
          id: c.article_id,
          revision: c.revision,
          path: c.path,
          before_sha: c.before_sha,
          after_sha: c.sha,
          material_hash: c.material_hash,
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    ]),
  );
}
