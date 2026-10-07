import test from 'node:test';
import assert from 'node:assert/strict';
import { siteSettings } from '../scripts/site-settings.mjs';
import { mainLink, mensLink } from '../src/lib/site-links.mjs';
const urls = { main: 'https://beauty.example/', mens: 'https://mens.beauty.example/' };
test('本体とメンズを行き来し、共通記事は本体へつなぐ', () => {
  assert.equal(mensLink({ mensUrl: urls.mens }), urls.mens);
  assert.equal(mainLink('articles/mens-care-basics/', { mensSite: true, mainUrl: urls.main }), `${urls.main}articles/mens-care-basics/`);
  assert.equal(mainLink('finder/?area=skin', { mensSite: true, mainUrl: urls.main }), `${urls.main}finder/?area=skin`);
  assert.equal(mainLink(), '/');
  assert.equal(mensLink(), '/mens/');
  assert.equal(mainLink('search/', { base: '/beauty-app/' }), '/beauty-app/search/');
});
test('公開用の接続先がない場合や同じサイトへの循環リンクを拒否する', () => {
  assert.throws(() => siteSettings({}, { required: true }), /両方/);
  assert.throws(() => siteSettings({ PUBLIC_MAIN_SITE_URL: urls.main, PUBLIC_MENS_SITE_URL: urls.main }), /別のドメイン/);
  for (const value of ['javascript:alert(1)', 'https://user:pass@beauty.example', 'https://beauty.example/?q=x', 'http://beauty.example/']) assert.throws(() => siteSettings({ PUBLIC_MENS_SITE_URL: value }));
  assert.throws(() => siteSettings({ PUBLIC_MENS_SITE_URL: `${urls.mens}mens/` }), /ルート/);
});
test('末尾を正規化し、ローカルの別ポートでも検証できる', () => {
  assert.deepEqual(siteSettings({ PUBLIC_MAIN_SITE_URL: urls.main.slice(0, -1), PUBLIC_MENS_SITE_URL: urls.mens }), urls);
  assert.deepEqual(siteSettings({ PUBLIC_MAIN_SITE_URL: 'http://127.0.0.1:4325', PUBLIC_MENS_SITE_URL: 'http://127.0.0.1:4326' }, { required: true }), { main: 'http://127.0.0.1:4325/', mens: 'http://127.0.0.1:4326/' });
});
