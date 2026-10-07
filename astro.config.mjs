import { defineConfig } from 'astro/config';
import { writeFile } from 'node:fs/promises';
import { loadLocalEnv, deploymentSettings } from './scripts/site-settings.mjs';
loadLocalEnv();
const urls = deploymentSettings();
const base = process.env.BASE_PATH || '/';
const localPreview = process.env.BEAUTY_LOCAL_PREVIEW === 'true';
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  site: urls.main,
  base,
  server: { host: '127.0.0.1', port: 4325 },
  vite: { define: {
    'import.meta.env.PUBLIC_SITE_VARIANT': JSON.stringify('main'),
    'import.meta.env.PUBLIC_MAIN_SITE_URL': JSON.stringify(urls.main),
    // Local navigation stays on the current origin, including its actual port.
    'import.meta.env.PUBLIC_MENS_SITE_URL': JSON.stringify(localPreview ? '' : urls.mens),
  } },
  integrations: [{
    name: 'cloudflare-mens-redirect',
    hooks: { 'astro:build:done': async ({ dir }) => {
      if (localPreview) return;
      const path = `${base.replace(/\/$/, '')}/mens`;
      await writeFile(new URL('_redirects', dir), `${path} ${urls.mens} 301\n${path}/ ${urls.mens} 301\n`);
    } },
  }],
});
