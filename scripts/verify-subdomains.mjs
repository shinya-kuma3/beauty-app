import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadLocalEnv, deploymentSettings, useSameOriginMens } from './site-settings.mjs';
loadLocalEnv();
const localPreview = process.argv.includes('--local');
if (localPreview) {
  process.env.PUBLIC_MAIN_SITE_URL = 'http://127.0.0.1:4325/';
  process.env.PUBLIC_MENS_SITE_URL = 'http://127.0.0.1:4326/';
}
const urls = deploymentSettings();
const sameOriginMens = localPreview || useSameOriginMens();
const main = await readFile('dist/index.html', 'utf8');
const mens = await readFile('dist-mens/index.html', 'utf8');
const old = await readFile('dist/mens/index.html', 'utf8');
const base = (process.env.BASE_PATH || '/').replace(/\/$/, '');
if (sameOriginMens) {
  assert.ok(main.includes(`href="${base}/mens/"`), 'プレビューでは同じホストのメンズへ');
  assert.ok(old.includes('mens-theme') && old.includes('総合トップ') && !old.includes('http-equiv="refresh"'), 'プレビュー /mens/ はメンズページを表示');
  for (const path of ['', 'search/', 'ingredients/', 'articles/', 'finder/']) assert.ok(old.includes(`href="${base}/${path}"`), `プレビューのメンズから共通ページへ: ${path}`);
  for (const html of [main, old]) assert.ok(!html.includes(`href="${urls.mens}"`), 'プレビューから本番メンズへ移動しない');
  await assert.rejects(access('dist/_redirects'), 'プレビューでは本番へ転送しない');
} else {
  const redirects = await readFile('dist/_redirects', 'utf8');
  assert.ok(main.includes(`href="${urls.mens}"`), '本体のヘッダーからメンズへ');
  assert.ok(old.includes(urls.mens) && old.includes('http-equiv="refresh"'), '旧 /mens/ は移転先へ');
  assert.ok(redirects.includes(`${base}/mens/ ${urls.mens} 301`), 'Cloudflare の HTTP 301');
}
assert.ok(mens.includes('mens-theme') && mens.includes('整える。'), 'メンズのルートが濃い青のトップ');
assert.ok(mens.includes(`rel="canonical" href="${urls.mens}"`), 'メンズ独自の canonical');
for (const path of ['', 'ingredients/', 'articles/', 'articles/mens-care-basics/', 'articles/hair-washing-basics/', 'ingredients/ceramide/', 'finder/', 'search/', 'about/']) assert.ok(mens.includes(`href="${urls.main}${path}"`), `本体へのリンク: ${path}`);
for (const match of mens.matchAll(/(?:src|href)="(\/(?:_astro\/[^"\s]+|favicon.svg))"/g)) await access(resolve('dist-mens', match[1].slice(1)));
for (const path of ['ingredients', 'articles', 'finder', 'search-index.json']) await assert.rejects(access(resolve('dist-mens', path)), `共通コンテンツを重複生成しない: ${path}`);
assert.ok(!/href="\/(?:ingredients|articles|finder|search|about)\//.test(mens), 'メンズ側に存在しないローカルリンクを作らない');
await access('dist-mens/404.html');
console.log(`Subdomains verified: independent mens root, main content links, local assets, canonical and ${sameOriginMens ? 'same-origin preview navigation' : 'Cloudflare redirects'}`);
