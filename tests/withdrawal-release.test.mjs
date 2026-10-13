import test from "node:test";
import assert from "node:assert/strict";
import { syncWithdrawals } from "../scripts/withdrawal-release.mjs";
import {
  mergeVisibility,
  validateAppend,
} from "../shared/withdrawal-content.mjs";
const row = {
  id: "c2466b2d-e802-47e7-8f7a-9e75aa9aa36c",
  slug: "moisturizer-basics",
};
function fixture() {
  const heads = {
      main: { sha: "a".repeat(40) },
      develop: { sha: "b".repeat(40) },
    },
    content = {
      main: mergeVisibility(null, []),
      develop: mergeVisibility(null, []),
    },
    calls = [];
  let fail = false,
    builds = 0;
  return {
    calls,
    content,
    setFail: (v) => (fail = v),
    counts: () => builds,
    github: {
      async head(branch) {
        return { ...heads[branch], branch };
      },
      async visibility(head) {
        return content[head.branch];
      },
      async commitVisibility(branch, head, value) {
        assert.equal(head.sha, heads[branch].sha);
        validateAppend(content[branch], value);
        calls.push(branch);
        content[branch] = value;
        heads[branch] = { sha: (branch === "main" ? "c" : "d").repeat(40) };
        return { ...heads[branch], branch };
      },
    },
    release: {
      async api(path) {
        if (path === "withdrawals") return { version: 1, withdrawals: [row] };
        if (path === "withdrawals/pending") return { ids: [row.id] };
        return { ok: true };
      },
    },
    verify: async () => {
      if (fail) throw Error("Validation failed");
    },
    trigger: async () => {
      builds++;
      return crypto.randomUUID();
    },
  };
}
test("非公開はdevelopへ先に同期し、検証後にmainを更新・再ビルドする", async () => {
  const f = fixture();
  const result = await syncWithdrawals(f);
  assert.deepEqual(f.calls, ["develop", "main"]);
  assert.equal(result.state, "withdrawals_building");
  assert.equal(f.counts(), 1);
  assert.ok(f.content.main.includes(row.slug));
});
test("非公開の検証失敗ではmainへ進めず、Hook失敗は重複commitせず再試行する", async () => {
  const f = fixture();
  f.setFail(true);
  await assert.rejects(syncWithdrawals(f), /Validation/);
  assert.deepEqual(f.calls, ["develop"]);
  assert.equal(f.counts(), 0);
  f.setFail(false);
  let fail = true;
  const trigger = f.trigger;
  f.trigger = async () => {
    if (fail) throw Error("Hook failed");
    return trigger();
  };
  await assert.rejects(syncWithdrawals(f), /Hook/);
  assert.deepEqual(f.calls, ["develop", "main"]);
  fail = false;
  await syncWithdrawals(f);
  assert.deepEqual(f.calls, ["develop", "main"]);
  assert.equal(f.counts(), 1);
});
test("非公開ファイルは本文・コードを含めず、削除・再公開・パス改ざんを拒否する", () => {
  const before = mergeVisibility(null, [row]);
  assert.throws(
    () => validateAppend(before, mergeVisibility(null, [])),
    /cannot be removed/,
  );
  assert.throws(
    () => mergeVisibility(before, [{ ...row, id: crypto.randomUUID() }]),
    /identity/,
  );
  assert.throws(() => mergeVisibility(null, [{ ...row, slug: "../escape" }]));
  assert.throws(() => mergeVisibility(null, [{ ...row, body: "private" }]));
});
