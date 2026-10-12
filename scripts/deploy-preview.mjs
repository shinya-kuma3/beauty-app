import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const requiredSecrets = [
  'INGEST_API_KEY',
  'CONTENT_EXPORT_KEY',
  'GEMINI_API_KEY',
  'YOUTUBE_API_KEY',
  'ACCESS_TEAM_DOMAIN',
  'ACCESS_AUD',
  'ADMIN_EMAILS',
];
export function previewSecrets(output, preview) {
  const text = output.replace(/\x1b\[[0-9;]*m/g, '');
  if (!text.includes('Preview: ' + preview) || !text.includes('Secrets'))
    throw new Error(
      'Preview secret list format changed; deployment stopped to preserve existing secrets.',
    );
  const names = [
    ...text.matchAll(/^[│┃]\s*(.+?)\s+Environment Variable\s+\*{4,}/gm),
  ].map((m) => m[1]);
  const missing = requiredSecrets.filter((name) => !names.includes(name));
  if (missing.length)
    throw new Error(
      'Set these secrets on this Preview before deployment: ' +
        missing.join(', '),
    );
  return [...new Set(names)];
}
export async function deploy(args = process.argv.slice(2)) {
  if (
    args.some(
      (a, i) =>
        !['--name', '--dry-run'].includes(a) && args[i - 1] !== '--name',
    )
  )
    throw new Error(
      'Use npm run deploy:preview -- [--name <existing-preview>] [--dry-run]',
    );
  const nameFlag = args.indexOf('--name');
  let name =
    nameFlag >= 0 ? args[nameFlag + 1] : process.env.WORKERS_CI_BRANCH;
  if (!name) {
    const branch = spawnSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
    });
    if (branch.status)
      throw new Error('Could not determine Preview branch');
    name = branch.stdout.trim();
  }
  if (
    !name ||
    name.startsWith('--') ||
    name === 'main' ||
    name.length > 200
  )
    throw new Error('Specify a test Preview name; main is not allowed.');
  const cli = resolve('node_modules/wrangler/bin/wrangler.js');
  const list = spawnSync(
    process.execPath,
    [cli, 'preview', 'secret', 'list', '--name', name],
    { encoding: 'utf8', env: process.env },
  );
  if (list.status) {
    console.error(list.stderr);
    throw new Error(
      'Could not read existing Preview secrets. No deployment was started. Initialize a new Preview and its secrets first.',
    );
  }
  const names = previewSecrets(list.stdout, name);
  const config = JSON.parse(
    await readFile('wrangler.pipeline.jsonc', 'utf8'),
  );
  config.main = resolve(config.main);
  config.assets.directory = resolve(config.assets.directory);
  config.previews.unsafe = {
    ...config.previews.unsafe,
    bindings: [
      ...(config.previews.unsafe?.bindings ?? []).filter(
        (b) => !names.includes(b.name),
      ),
      ...names.map((name) => ({ name, type: 'inherit' })),
    ],
  };
  await mkdir('.wrangler', { recursive: true });
  const file = resolve('.wrangler/preview-deploy.local.json');
  await writeFile(file, JSON.stringify(config, null, 2));
  console.log(
    'Preview ' +
      name +
      ': preserving ' +
      names.length +
      ' existing secrets. Values are not read or exported.',
  );
  if (args.includes('--dry-run')) return;
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'preview',
      '--name',
      name,
      '--config',
      file,
      '--ignore-base-config',
    ],
    { stdio: 'inherit', env: process.env },
  );
  if (result.status) throw new Error('Preview deployment failed');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  deploy().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
