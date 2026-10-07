import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { deploymentSites } from '../site.config.mjs';

export function loadLocalEnv() {
  if (existsSync('.env')) loadEnvFile('.env');
}
export function siteUrl(value, name) {
  if (!value?.trim()) return '';
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error(`${name}: HTTPS のサイト URL を指定してください（ローカル開発のみ HTTP 可）。`);
  return `${url.origin}${url.pathname.replace(/\/$/, '')}/`;
}
export function siteSettings(env = process.env, { required = false } = {}) {
  const main = siteUrl(env.PUBLIC_MAIN_SITE_URL || env.SITE_URL, 'PUBLIC_MAIN_SITE_URL');
  const mens = siteUrl(env.PUBLIC_MENS_SITE_URL, 'PUBLIC_MENS_SITE_URL');
  if (required && (!main || !mens)) throw new Error('公開用メンズビルドには PUBLIC_MAIN_SITE_URL と PUBLIC_MENS_SITE_URL の両方が必要です。ローカル確認は npm run build:mens:local を使ってください。');
  if (main && mens && new URL(main).origin === new URL(mens).origin) throw new Error('本体とメンズは別のドメイン（ローカルでは別ポート）を設定してください。');
  if (mens && new URL(mens).pathname !== '/') throw new Error('メンズの URL はサブドメインのルートを指定してください。');
  return { main, mens };
}
export function deploymentSettings(env = process.env) {
  return siteSettings({
    PUBLIC_MAIN_SITE_URL: env.PUBLIC_MAIN_SITE_URL || env.SITE_URL || deploymentSites.PUBLIC_MAIN_SITE_URL,
    PUBLIC_MENS_SITE_URL: env.PUBLIC_MENS_SITE_URL || deploymentSites.PUBLIC_MENS_SITE_URL,
  }, { required: true });
}
