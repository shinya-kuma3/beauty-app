import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const args = process.argv.slice(2),
  testId = args[args.indexOf('--test-id') + 1];
if (
  !args.includes('--test-id') ||
  !testId ||
  !/^([0-9a-f]{8}-){1}[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    testId,
  ) ||
  testId === '00000000-0000-0000-0000-000000000000'
)
  throw new Error(
    'Use: npm run setup:cloudflare -- --test-id <test D1 database UUID>',
  );
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
if (
  config.previews.d1_databases[0].database_id !== testId &&
  config.previews.d1_databases[0].database_id !==
    '00000000-0000-0000-0000-000000000000'
)
  throw new Error('A different test database is already configured');
if (testId === config.d1_databases[0].database_id)
  throw new Error('Test and production databases must be different');
config.previews.d1_databases[0].database_id = testId;
await writeFile('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
const local = {
  ...config,
  name: 'beauty-app-test-local',
  d1_databases: config.previews.d1_databases,
  vars: config.previews.vars,
};
delete local.previews;
delete local.triggers;
await writeFile(
  'wrangler.test.local.json',
  JSON.stringify(local, null, 2) + '\n',
);
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/wrangler/bin/wrangler.js'),
    'd1',
    'migrations',
    'apply',
    'beauty-content-test',
    '--remote',
    '--config',
    'wrangler.test.local.json',
  ],
  { stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
  if (code === 0)
    console.log(
      'Test D1 configured. Commit the updated wrangler.jsonc; keep wrangler.test.local.json private.',
    );
});
