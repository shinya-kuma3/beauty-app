import { z } from 'zod';
import MarkdownIt from 'markdown-it';
export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export const now = () => new Date().toISOString();
export async function hash(value) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function secureEqual(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([hash(left), hash(right)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function normalizeUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password)
    throw new ApiError(400, 'invalid_url');
  u.hash = '';
  for (const k of [...u.searchParams.keys()])
    if (k.startsWith('utm_') || ['fbclid', 'gclid'].includes(k))
      u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href;
}
const https = z
  .url()
  .max(2000)
  .refine((v) => {
    try {
      return (
        new URL(v).protocol === 'https:' &&
        !new URL(v).username &&
        !new URL(v).password
      );
    } catch {
      return false;
    }
  });
const text = (max) => z.string().trim().min(1).max(max);
export const sourceInput = z
  .object({
    type: z.enum(['x', 'research']),
    source_url: https,
    author: text(200),
    title: text(120),
    raw_summary: text(50000),
    language: text(20).default('ja'),
  })
  .strict();
export const articleInput = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    title: text(120),
    body_markdown: text(50000).min(40),
    excerpt: text(300),
    category: z.enum(['skin', 'hair', 'nail', 'body']),
    tags: z.array(text(30)).max(5).default([]),
    source_ids: z.array(z.uuid()).min(1).max(20),
    citations: z.array(https).min(1).max(20),
    ai_check_notes: text(10000),
  })
  .strict();
export const editInput = articleInput
  .omit({ slug: true, source_ids: true })
  .extend({ revision: z.number().int().positive() })
  .strict();
export const summarySchema = z
  .object({ summary: text(200), key_points: z.array(text(60)).min(1).max(3) })
  .strict();
export const videoSchema = summarySchema
  .extend({
    products: z.array(text(150)).max(8),
    ingredients: z.array(text(100)).max(12),
    claims: z
      .array(z.object({ claim: text(250), evidence: text(250) }).strict())
      .max(6),
    timestamps: z
      .array(
        z
          .object({
            time: z.string().regex(/^\d{1,3}:\d{2}(?::\d{2})?$/),
            detail: text(150),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export function parse(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'invalid_input');
  return parsed.data;
}
export function plain(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function shortInput(row, limit) {
  const body = row.body_markdown ?? row.raw_summary ?? '';
  const headings = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((m) => plain(m[1]))
    .join('\n')
    .slice(0, 400);
  return `${plain(row.title).slice(0, 120)}\n${headings}\n${plain(body)}`.slice(
    0,
    limit,
  );
}
export async function contentHash(row) {
  return hash(
    JSON.stringify([
      plain(row.title),
      plain(row.body_markdown ?? row.raw_summary ?? ''),
      row.video_id ?? null,
    ]),
  );
}
export function cosine(a, b) {
  if (!a.length || a.length !== b.length) return -1;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}
export function selectTags(vector, candidates, threshold) {
  return candidates
    .map((t) => ({ ...t, score: cosine(vector, t.vector) }))
    .filter((t) => t.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((t) => ({ label: t.label, score: Number(t.score.toFixed(4)) }));
}
export function reviewFlags(row) {
  const flags = [];
  if (
    /治[るす]|完治|必ず|確実に|副作用[がは]?ない|効果[がは]?保証|薬の代わり|診断|治療/.test(
      row.body_markdown,
    )
  )
    flags.push('医療・効果の断定に見える表現を確認してください。');
  flags.push('出典が各主張を支えるか、管理者が原文を確認してください。');
  return flags;
}
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.disable('image');
md.validateLink = (link) => {
  try {
    return new URL(link).protocol === 'https:';
  } catch {
    return link.startsWith('/') && !link.startsWith('//');
  }
};
export const renderMarkdown = (body) => md.render(body);
export function decode(row) {
  if (!row) return null;
  const out = { ...row };
  for (const field of ['tags', 'citations', 'key_points', 'ai_tags'])
    if (field in out) out[field] = out[field] ? JSON.parse(out[field]) : [];
  return out;
}
export async function enqueue(db, type, id, content_hash) {
  const time = now();
  await db
    .prepare(
      'INSERT OR IGNORE INTO ai_jobs(id,entity_type,entity_id,content_hash,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(crypto.randomUUID(), type, id, content_hash, time, time)
    .run();
}
export async function rateLimit(db, env) {
  const time = new Date(),
    bucket = `ingest:${time.toISOString().slice(0, 16)}`;
  const row = await db
    .prepare(
      'INSERT INTO rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits',
    )
    .bind(bucket, new Date(time.getTime() + 120000).toISOString())
    .first();
  if (row.hits > env) throw new ApiError(429, 'rate_limited');
}
