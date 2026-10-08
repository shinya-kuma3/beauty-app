import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadLocalEnv, deploymentSettings } from './site-settings.mjs';
import { exportContent } from './export-content.mjs';
loadLocalEnv();
const [variant, command, ...options] = process.argv.slice(2);
if (
  !['main', 'mens'].includes(variant) ||
  !['build', 'dev', 'preview'].includes(command)
)
  throw new Error('Unsupported site command');
if (options.includes('--local')) {
  process.env.BEAUTY_LOCAL_PREVIEW = 'true';
  process.env.PUBLIC_MAIN_SITE_URL = 'http://127.0.0.1:4325/';
  process.env.PUBLIC_MENS_SITE_URL = 'http://127.0.0.1:4326/';
}
deploymentSettings();
if (command === 'build') await exportContent();
const require = createRequire(import.meta.url);
const packagePath = require.resolve('astro/package.json');
const astroPackage = JSON.parse(await readFile(packagePath, 'utf8'));
const cli = resolve(dirname(packagePath), astroPackage.bin.astro);
const config =
  variant === 'mens' ? 'astro.mens.config.mjs' : 'astro.config.mjs';
const args = [cli, command, '--config', config];
args.push(...options.filter((option) => option !== '--local'));
// Astro tracks one server per repository. The second site runs alongside it.
if (variant === 'mens' && command !== 'build') args.push('--ignore-lock');
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
