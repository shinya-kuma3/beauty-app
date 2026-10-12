import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { articleFile, digest } from '../shared/release-content.mjs';
import {
  syncAndRelease,
  gitBlobSha,
  validateFile,
  validateHook,
  GitHub,
} from '../scripts/content-release.mjs';
import { exportContent } from '../scripts/export-content.mjs';
const raw = {
  id: 'c2466b2d-e802-47e7-8f7a-9e75aa9aa36c',
  slug: 'approved-care',
  title: '保湿を考える',
  body_markdown: '## ケア\n' + '自分に合う使い心地を考えます。'.repeat(4),
  excerpt: '基本のケア',
  category: 'skin',
  tags: ['保湿'],
  citations: ['https://example.org/paper'],
  updated_at: '2026-10-12T00:00:00.000Z',
  published_at: '2026-10-12T00:00:00.000Z',
  revision: 4,
};
const file = await articleFile(raw);
function fixture(state = 'pending') {
  const commits = [],
    calls = [],
    heads = {
      main: { sha: 'a'.repeat(40), tree: 'main-tree' },
      develop: { sha: 'b'.repeat(40), tree: 'develop-tree' },
    },
    trees = new Map([
      ['main-tree', new Map()],
      ['develop-tree', new Map()],
    ]);
  let verifyCount = 0,
    hookCount = 0;
  const github = {
    async head(branch) {
      return heads[branch];
    },
    async snapshots(head) {
      return trees.get(head.tree);
    },
    async content() {
      return null;
    },
    async commit(branch, head, files) {
      if (heads[branch].sha !== head.sha) throw Error('Branch changed');
      commits.push({ branch, files });
      const next = {
        sha: (branch === 'main' ? 'c' : 'd').repeat(40),
        tree: branch + '-updated',
      };
      trees.set(
        next.tree,
        new Map([
          ...trees.get(head.tree),
          ...files.map((f) => [f.path, { sha: gitBlobSha(f.content) }]),
        ]),
      );
      heads[branch] = next;
      return next;
    },
  };
  const release = {
    async files() {
      return [file];
    },
    async api(path, method, body) {
      calls.push({ path, method, body });
      if (path === 'reconcile' || path === 'builds')
        return { releases: [] };
      if (path === 'requests')
        return { id: 'request', digest: '1'.repeat(64) };
      if (path === 'requests/request')
        return {
          state,
          digest: '1'.repeat(64),
          main_base_sha: 'a'.repeat(40),
          develop_sha: 'd'.repeat(40),
        };
      return { state: 'released' };
    },
  };
  return {
    commits,
    calls,
    heads,
    github,
    release,
    verify: async () => {
      verifyCount++;
    },
    trigger: async () => {
      hookCount++;
      return 'd291053c-b95b-4448-ba8a-d622e7d4b7f8';
    },
    counts: () => ({ verifyCount, hookCount }),
  };
}
test('承認記事をdevelopへ先に同期し、Grok待ち・拒否ではmainを変更しない', async () => {
  for (const state of ['pending', 'rejected', 'superseded']) {
    const f = fixture(state),
      result = await syncAndRelease(f);
    assert.equal(f.commits.length, 1);
    assert.equal(f.commits[0].branch, 'develop');
    assert.equal(
      result.state,
      state === 'rejected' ? 'blocked' : 'waiting_grok',
    );
    assert.equal(f.counts().hookCount, 0);
  }
});
test('Grokの合格後に検証し、記事ファイルだけをmainへ書き、静的ビルドを起動する', async () => {
  const f = fixture('approved');
  const result = await syncAndRelease(f);
  assert.equal(result.state, 'building');
  assert.deepEqual(
    f.commits.map((c) => c.branch),
    ['develop', 'main'],
  );
  assert.deepEqual(
    f.commits[1].files.map((f) => f.path),
    ['src/content/approved-articles/approved-care.json'],
  );
  assert.deepEqual(f.counts(), { verifyCount: 1, hookCount: 1 });
  assert.ok(f.calls.some((c) => c.path.endsWith('/published')));
  assert.ok(f.calls.some((c) => c.path.endsWith('/build')));
});
test('テスト失敗・版違い・途中のdevelop変更でmain反映を止める', async () => {
  const bad = fixture('approved');
  bad.verify = async () => {
    throw Error('Tests failed');
  };
  await assert.rejects(syncAndRelease(bad), /Tests failed/);
  assert.deepEqual(
    bad.commits.map((c) => c.branch),
    ['develop'],
  );
  const stale = fixture('approved');
  stale.verify = async () => {
    stale.heads.develop = { sha: 'e'.repeat(40), tree: 'changed' };
  };
  await assert.rejects(syncAndRelease(stale), /Develop changed/);
  assert.equal(stale.commits.length, 1);
});
test('記事以外のパス・同一ファイルの内容改ざん・不正なHookを拒否する', async () => {
  assert.equal(
    gitBlobSha('test'),
    '30d74d258442c7c65512eafab474568dd706c430',
  );
  assert.throws(() =>
    validateFile({ ...file, path: '.github/workflows/evil.yml' }),
  );
  assert.throws(() =>
    validateFile({
      ...file,
      path: 'src/content/approved-articles/../evil.json',
    }),
  );
  assert.throws(() => validateHook('https://example.org/deploy'));
  const github = new GitHub('fake', async () => {
    throw Error('Network must not be called');
  });
  await assert.rejects(
    github.commit('main', { sha: 'a'.repeat(40) }, [
      { ...file, content: file.content + ' ' },
    ]),
    /hash mismatch/,
  );
});
test('本番ビルドはGitの固定記事のみを使い、DBの最新版を勝手に取得しない', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beauty-git-content-'));
  try {
    await mkdir(join(root, 'src/content/articles'), { recursive: true });
    await mkdir(join(root, 'src/content/approved-articles'), {
      recursive: true,
    });
    await writeFile(join(root, file.path), file.content);
    const count = await exportContent(
      {
        WORKERS_CI_BRANCH: 'main',
        CONTENT_PIPELINE_ENABLED: 'true',
        CONTENT_API_URL: 'https://must-not-call.example',
        CONTENT_EXPORT_KEY: 'wrong',
      },
      root,
    );
    assert.equal(count, 1);
    const manifest = JSON.parse(
      await readFile(join(root, 'public/content-manifest.json'), 'utf8'),
    );
    assert.equal(manifest.environment, 'production');
    assert.deepEqual(manifest.articles, [
      { id: raw.id, revision: 4, sha: await digest(file.content) },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
