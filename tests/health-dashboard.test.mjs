import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { adminPage } from "../worker/admin.mjs";
import { quota } from "../worker/health.mjs";
const script = await readFile(
  new URL("../public/admin-health.js", import.meta.url),
  "utf8",
);
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const fixture = () => ({
  configured: true,
  plan: "free",
  start: "2026-10-20T00:00:00Z",
  end: "2026-10-20T01:00:00Z",
  reset_at: "2026-10-21T00:00:00Z",
  local_http_errors: 2,
  database_id: "db1",
  quotas: {
    workers: quota(85000, 100000),
    reads: quota(null, 5000000),
    writes: quota(120000, 100000),
    storage: quota(0, 5000000000),
  },
  segments: {
    workers: {
      data: {
        requests: 85000,
        errors: 5,
        workers: [
          {
            name: "<img src=x onerror=alert(1)>",
            status: "exception",
            requests: 85000,
            errors: 5,
          },
        ],
        hourly: [],
        detail_complete: true,
      },
      fetched_at: "2026-10-20T01:00:00Z",
      stale: true,
      error_code: "monitor_permission_denied",
    },
    d1: { data: null, fetched_at: null, stale: false, error_code: null },
    storage: {
      data: { databases: [], complete: true, total_bytes: 0 },
      fetched_at: "2026-10-20T01:00:00Z",
      stale: false,
      error_code: null,
    },
  },
  links: {
    workers: "https://dash.cloudflare.com/test/workers-and-pages",
    d1: "https://dash.cloudflare.com/test/workers/d1",
  },
});
function window() {
  return new Window({
    url: "https://example.test/admin",
    settings: {
      enableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
}
test("未取得・ゼロ・古いデータを区別し、負の残量を出さずWorker名を安全に表示する", async () => {
  const w = window();
  try {
    w.document.write(adminPage());
    w.fetch = async (url) =>
      Response.json(
        String(url).endsWith("/me") ? { role: "admin" } : fixture(),
      );
    w.eval(script);
    await settle();
    const root = w.document.getElementById("health-tools");
    assert.equal(root.hidden, false);
    root.open = true;
    root.dispatchEvent(new w.Event("toggle"));
    await settle();
    assert.match(root.textContent, /前回取得した値/);
    assert.match(root.textContent, /15,000回/);
    assert.match(root.textContent, /未取得のため残量は計算していません/);
    assert.equal(root.querySelector("img"), null);
    assert.match(root.textContent, /<img/);
    assert.match(root.textContent, /HTTP 5xx：今日 2件/);
    assert.equal(root.querySelectorAll("progress").length, 3);
    assert.equal(
      root.querySelector(".health-quota.exceeded progress").value,
      100,
    );
    assert.doesNotMatch(root.textContent, /-20,000/);
    assert.equal(root.hasAttribute("aria-busy"), false);
  } finally {
    await w.happyDOM.close();
  }
});
test("編集者には監視UIを表示せず、データ取得を実行しない", async () => {
  const w = window();
  try {
    w.document.write(adminPage());
    let calls = 0;
    w.fetch = async () => {
      calls++;
      return Response.json({ role: "editor" });
    };
    w.eval(script);
    await settle();
    const root = w.document.getElementById("health-tools");
    root.open = true;
    root.dispatchEvent(new w.Event("toggle"));
    await settle();
    assert.equal(root.hidden, true);
    assert.equal(calls, 1);
  } finally {
    await w.happyDOM.close();
  }
});
test("未設定なら初回設定を表示し、再取得失敗でも前回のカードを消さない", async () => {
  const w = window();
  try {
    w.document.write(adminPage());
    let failure = false;
    const data = fixture();
    data.configured = false;
    w.fetch = async (url) =>
      String(url).endsWith("/me")
        ? Response.json({ role: "admin" })
        : failure
          ? Response.json(
              { error: { code: "monitor_sync_wait" } },
              { status: 429 },
            )
          : Response.json(data);
    w.eval(script);
    await settle();
    const root = w.document.getElementById("health-tools");
    root.open = true;
    root.dispatchEvent(new w.Event("toggle"));
    await settle();
    assert.equal(w.document.getElementById("health-setup").hidden, false);
    assert.equal(w.document.getElementById("health-refresh").disabled, true);
    const before = w.document.getElementById("health-quotas").textContent;
    failure = true;
    root.dispatchEvent(new w.Event("toggle"));
    await settle();
    assert.match(
      w.document.getElementById("health-message").textContent,
      /1分に1回/,
    );
    assert.equal(
      w.document.getElementById("health-quotas").textContent,
      before,
    );
  } finally {
    await w.happyDOM.close();
  }
});
