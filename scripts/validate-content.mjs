import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadRecords(root = process.cwd()) {
  const records = [];
  for (const collection of ['ingredients', 'articles']) {
    const folder = resolve(root, 'src/content', collection);
    for (const file of (await readdir(folder)).filter((file) => file.endsWith('.json'))) {
      records.push({ collection, id: file.slice(0, -5), data: JSON.parse(await readFile(resolve(folder, file), 'utf8')) });
    }
  }
  return records;
}
export function validateRecords(records) {
  const errors = [];
  const ingredientIds = new Set(records.filter((r) => r.collection === 'ingredients' && r.data.status === 'published').map((r) => r.id));
  const seen = new Set();
  for (const { collection, id, data } of records) {
    const key = `${collection}/${id}`;
    const fail = (message) => errors.push(`${key}: ${message}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail('ファイル名は小文字の英数字とハイフンにしてください');
    if (seen.has(key)) fail('ID が重複しています');
    seen.add(key);
    if ('slug' in data) fail('slug は指定せず、ファイル名を ID として使ってください');
    for (const field of ['title', 'summary']) if (typeof data[field] !== 'string' || !data[field].trim()) fail(`${field} が必要です`);
    if (!['skin', 'hair', 'nail', 'body'].includes(data.category)) fail('category は skin / hair / nail / body のいずれかです');
    if (data.areas !== undefined && (!Array.isArray(data.areas) || !data.areas.length || !data.areas.every(area => ['skin', 'hair', 'nail', 'body'].includes(area)) || !data.areas.includes(data.category))) fail('areas は有効なカテゴリと主カテゴリを含めてください');
    if (data.status !== undefined && !['draft', 'published'].includes(data.status)) fail('status は draft / published のいずれかです');
    const date = typeof data.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.updatedAt) ? new Date(`${data.updatedAt}T00:00:00Z`) : new Date(NaN);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== data.updatedAt) fail('updatedAt は実在する YYYY-MM-DD の日付にしてください');
    if (!Array.isArray(data.tags) || !data.tags.length || !data.tags.every((tag) => typeof tag === 'string' && tag.trim())) fail('tags に検索用の文字列を指定してください');
    if (!Array.isArray(data.sections) || !data.sections.length || !data.sections.every((s) => typeof s.heading === 'string' && s.heading.trim() && typeof s.body === 'string' && s.body.trim())) fail('sections に見出しと本文が必要です');
    if (!Array.isArray(data.sources) || !data.sources.length) fail('出典が必要です');
    for (const source of data.sources || []) {
      try { if (new URL(source.url).protocol !== 'https:') fail('出典 URL は HTTPS にしてください'); } catch { fail('出典 URL が不正です'); }
      if (!source.title || !['guideline', 'research', 'official', 'x'].includes(source.kind)) fail('出典の title / kind を確認してください');
    }
    if (data.status === 'published' && !(data.sources || []).some((s) => ['guideline', 'research', 'official'].includes(s.kind))) fail('公開する情報には X 以外の参考資料が必要です');
    for (const url of data.discoveryUrls || []) { try { if (new URL(url).protocol !== 'https:') fail('discoveryUrls は HTTPS にしてください'); } catch { fail('discoveryUrls が不正です'); } }
    if (collection === 'ingredients') for (const field of ['englishName', 'role', 'caution']) if (typeof data[field] !== 'string' || !data[field].trim()) fail(`${field} が必要です`);
    if (collection === 'articles') {
      if (!Number.isInteger(data.readingMinutes) || data.readingMinutes < 1) fail('readingMinutes は1以上の整数です');
      if (data.status === 'published') for (const target of data.relatedIngredients || []) if (!ingredientIds.has(target)) fail(`関連成分 ${target} が存在しないか、未公開です`);
    }
  }
  return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const records = await loadRecords();
    const errors = validateRecords(records);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log(`Content valid: ${records.length} records (${records.filter((r) => r.data.status === 'published').length} published)`);
  } catch (error) { console.error(`Content validation failed: ${error.message}`); process.exitCode = 1; }
}
