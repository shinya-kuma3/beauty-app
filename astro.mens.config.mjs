import { defineConfig } from 'astro/config';
import { loadLocalEnv, deploymentSettings } from './scripts/site-settings.mjs';
loadLocalEnv();
const urls = deploymentSettings();
export default defineConfig({
  srcDir: './src-mens',
  outDir: './dist-mens',
  cacheDir: './node_modules/.astro-mens',
  output: 'static',
  trailingSlash: 'always',
  site: urls.mens,
  base: '/',
  server: { host: '127.0.0.1', port: 4326 },
  vite: { define: {
    'import.meta.env.PUBLIC_SITE_VARIANT': JSON.stringify('mens'),
    'import.meta.env.PUBLIC_MAIN_SITE_URL': JSON.stringify(urls.main),
    'import.meta.env.PUBLIC_MENS_SITE_URL': JSON.stringify(urls.mens),
  } },
});
