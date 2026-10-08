import { readFile } from 'node:fs/promises';
import { loadLocalEnv } from './site-settings.mjs';
loadLocalEnv();
try {
  const file = await readFile('.dev.vars', 'utf8');
  for (const line of file.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}
if (!process.env.CONTENT_API_URL || !process.env.INGEST_API_KEY)
  throw new Error(
    'Set CONTENT_API_URL and INGEST_API_KEY locally (.env / .dev.vars)',
  );
const base = new URL(process.env.CONTENT_API_URL);
if (base.protocol !== 'https:' && base.hostname !== '127.0.0.1')
  throw new Error('Invalid target URL');
async function call(path, method = 'GET', body) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Authorization: `Bearer ${process.env.INGEST_API_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `Sample request failed (${response.status}, ${data.error?.code})`,
    );
  return data;
}
if ((await call('/api/ingest/health')).environment !== 'development')
  throw new Error('Sample fixtures may only be created in development');
for (const name of [
  'moisturizer-basics',
  'hair-washing-basics',
  'nail-care-basics',
]) {
  const record = JSON.parse(
    await readFile(`src/content/articles/${name}.json`, 'utf8'),
  );
  const sourceUrl = record.sources[0].url;
  let sourceId;
  try {
    sourceId = (
      await call('/api/ingest/sources', 'POST', {
        type: 'research',
        source_url: sourceUrl,
        author: '既存記事を使ったテスト素材',
        title: record.title,
        raw_summary: record.sections.map((s) => s.body).join('\n'),
        language: 'ja',
      })
    ).id;
  } catch (error) {
    if (!error.message.includes('duplicate_source')) throw error;
    for (const status of ['new', 'used']) {
      let offset = 0;
      do {
        const page = await call(
          `/api/ingest/sources?status=${status}&offset=${offset}`,
        );
        sourceId =
          page.sources.find((s) => s.source_url === sourceUrl)?.id ?? sourceId;
        offset = page.next_offset;
      } while (offset !== null && !sourceId);
    }
    if (!sourceId) throw error;
  }
  try {
    const created = await call('/api/ingest/articles', 'POST', {
      slug: `pipeline-test-${name}`,
      title: `【テスト】${record.title}`,
      body_markdown: record.sections
        .map((s) => `## ${s.heading}\n${s.body}`)
        .join('\n\n'),
      excerpt: record.summary,
      category: record.category,
      tags: [],
      source_ids: [sourceId],
      citations: record.sources.map((s) => s.url),
      ai_check_notes:
        '既存記事を入力にした動作確認用です。自動公開しないでください。出典の確認は管理者が行ってください。',
    });
    console.log(
      JSON.stringify({
        slug: `pipeline-test-${name}`,
        id: created.id,
        status: created.status,
      }),
    );
  } catch (error) {
    if (!error.message.includes('duplicate_slug')) throw error;
    console.log(`Already registered: pipeline-test-${name}`);
  }
}
console.log(
  'Open /admin and run AI processing. The real tags, summaries and usage appear there. Do not publish test fixtures.',
);
