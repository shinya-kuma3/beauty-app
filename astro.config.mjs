import { defineConfig } from 'astro/config';
import { writeFile } from 'node:fs/promises';
import { loadLocalEnv, deploymentSettings, useSameOriginMens } from './scripts/site-settings.mjs';
loadLocalEnv();
const urls = deploymentSettings();
const base = process.env.BASE_PATH || '/';
const sameOriginMens = useSameOriginMens();
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  site: urls.main,
  base,
  server: { host: '127.0.0.1', port: 4325 },
  vite: { define: {
    'import.meta.env.PUBLIC_SITE_VARIANT': JSON.stringify('main'),
    'import.meta.env.PUBLIC_MAIN_SITE_URL': JSON.stringify(urls.main),
    // Local and Workers previews keep men's care on the current host and port.
    'import.meta.env.PUBLIC_MENS_SITE_URL': JSON.stringify(sameOriginMens ? '' : urls.mens),
  } },
  integrations: [{
    name: 'cloudflare-mens-redirect',
    hooks: { 'astro:build:done': async ({ dir }) => {
      if (sameOriginMens) return;
      const path = `${base.replace(/\/$/, '')}/mens`;
      await writeFile(new URL('_redirects', dir), `${path} ${urls.mens} 301\n${path}/ ${urls.mens} 301\n`);
    } },
  }],
});
