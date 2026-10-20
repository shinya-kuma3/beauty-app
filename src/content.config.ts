import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {parseSnapshot} from '../shared/release-content.mjs';
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
    .array(
      z.object({ heading: z.string().min(1), body: z.string().min(1) }),
    )
    .min(1),
  sources: z
    .array(
      z.object({
        title: z.string().min(1),
        url: z.url({ protocol: /^https$/ }),
        kind: z.enum([
          'guideline',
          'research',
          'official',
          'reference',
          'x',
          'youtube',
        ]),
      }),
    )
    .default([]),
  discoveryUrls: z.array(z.url({ protocol: /^https$/ })).default([]),
};
const ingredients = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/ingredients' }),
  schema: z.object({
    ...common,
    entryType: z.enum(['ingredient', 'care-item']).default('ingredient'),
    sections: z.array(z.object({
      heading: z.string().min(1),
      body: z.string().min(1),
      highlight: z.string().trim().min(1).optional(),
    }).refine(section => !section.highlight || section.body.includes(section.highlight), {
      message: 'highlight は本文に含まれるフレーズを指定してください',
    })).min(1),
    englishName: z.string().min(1),
    role: z.string().min(1),
    caution: z.string().min(1),
  }),
});
const revisionFolder=process.env.CONTENT_PIPELINE_ENABLED==='true'&&process.env.WORKERS_CI_BRANCH!=='main'&&process.env.CONTENT_MODE!=='git'?'generated-articles':'approved-articles';
const revisionPath=new URL('./content/'+revisionFolder+'/',import.meta.url);
const overridden=existsSync(revisionPath)?readdirSync(revisionPath).filter(name=>name.endsWith('.json')).filter(name=>parseSnapshot(readFileSync(new URL(name,revisionPath),'utf8')).originalSlug===name.slice(0,-5)):[];
const articles = defineCollection({
  loader: glob({
    pattern: ['articles/*.json',revisionFolder+'/*.json',...overridden.map(name=>'!articles/'+name)],
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
    originalSlug: z.string().optional(),
    bodyMarkdown: z.string().optional(),
    aiAssisted: z.boolean().default(false),
    dbId: z.string().optional(),
    reviewRevision: z.number().optional(),
  }),
});
export const collections = { ingredients, articles };
