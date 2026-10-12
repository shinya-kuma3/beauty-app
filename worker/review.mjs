import { z } from 'zod';
import { hash } from './core.mjs';
export const reviewSchema = z
  .object({
    overview: z.string().min(1).max(200),
    findings: z
      .array(
        z
          .object({
            severity: z.enum(['warning', 'notice']),
            category: z.enum([
              'claim',
              'evidence',
              'wording',
              'consistency',
            ]),
            quote: z.string().max(180),
            reason: z.string().min(1).max(160),
            suggestion: z.string().min(1).max(180),
          })
          .strict(),
      )
      .max(6),
    questions: z.array(z.string().min(1).max(120)).max(3),
  })
  .strict();

export async function reviewInput(_env, row, sources) {
  const materials = sources
    .map((s) => ({
      id: s.id,
      title: s.title,
      url: s.source_url,
      status: s.status,
      type: s.type,
      language: s.language,
      raw_summary: s.raw_summary,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const snapshot = {
    title: row.title,
    body_markdown: row.body_markdown,
    excerpt: row.excerpt,
    citations: JSON.parse(row.citations),
    materials,
  };
  return {
    content_hash: await hash(
      JSON.stringify(['external-grok-v1', snapshot]),
    ),
    input_text: JSON.stringify(snapshot),
    body_chars: row.body_markdown.length,
    reviewed_chars: row.body_markdown.length,
  };
}
export const grokResultSchema = reviewSchema
  .extend({
    revision: z.number().int().positive(),
    ai_check_notes: z.string().trim().min(1).max(10000),
    checked_citations: z
      .array(
        z
          .url()
          .max(2000)
          .refine((v) => {
            const u = new URL(v);
            return u.protocol === 'https:' && !u.username && !u.password;
          }),
      )
      .min(1)
      .max(20),
    primary_source_notes: z.string().trim().min(1).max(500),
    pr_notes: z.string().trim().min(1).max(500),
    terms: z
      .array(
        z
          .object({
            original: z.string().min(1).max(100),
            japanese: z.string().min(1).max(100),
            language: z.string().min(1).max(20),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
