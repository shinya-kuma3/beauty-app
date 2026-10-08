import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const common = {
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(300),
  category: z.enum(['skin', 'hair', 'nail', 'body']),
  areas: z
    .array(z.enum(['skin', 'hair', 'nail', 'body']))
    .min(1)
    .optional(),
  tags: z.array(z.string().min(1)).max(8),
  status: z.enum(['draft', 'published']).default('draft'),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sections: z
    .array(z.object({ heading: z.string().min(1), body: z.string().min(1) }))
    .min(1),
  sources: z
    .array(
      z.object({
        title: z.string().min(1),
        url: z.url({ protocol: /^https$/ }),
        kind: z.enum(['guideline', 'research', 'official', 'reference', 'x']),
      }),
    )
    .min(1),
  discoveryUrls: z.array(z.url({ protocol: /^https$/ })).default([]),
};
const ingredients = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/ingredients' }),
  schema: z.object({
    ...common,
    englishName: z.string().min(1),
    role: z.string().min(1),
    caution: z.string().min(1),
  }),
});
const articles = defineCollection({
  loader: glob({
    pattern: ['articles/*.json', 'generated-articles/*.json'],
    base: './src/content',
    generateId: ({ entry }) =>
      entry
        .split(/[\\/]/)
        .pop()!
        .replace(/\.json$/, ''),
  }),
  schema: z.object({
    ...common,
    readingMinutes: z.number().int().min(1).max(60),
    relatedIngredients: z.array(z.string()).default([]),
    bodyMarkdown: z.string().optional(),
    aiAssisted: z.boolean().default(false),
    dbId: z.string().optional(),
    reviewRevision: z.number().optional(),
  }),
});
export const collections = { ingredients, articles };
