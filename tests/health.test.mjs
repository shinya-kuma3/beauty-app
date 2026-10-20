import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  healthOverview,
  syncHealth,
  quota,
  recordHttpFailure,
} from "../worker/health.mjs";
const account = "a".repeat(32),
  db1 = "11111111-1111-4111-8111-111111111111",
  db2 = "22222222-2222-4222-8222-222222222222";
function env() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(
      new URL("../migrations/0008_billing_dashboard.sql", import.meta.url),
      "utf8",
    ).replace(
      "CREATE INDEX ai_usage_month_provider ON ai_usage(day,provider,model);",
      "",
    ),
  );
  return {
    sql,
    CLOUDFLARE_ANALYTICS_TOKEN: "private-analytics-token",
    CLOUDFLARE_MONITOR_ACCOUNT_ID: account,
    CLOUDFLARE_WORKERS_PLAN: "free",
    CLOUDFLARE_MONITOR_DATABASE_ID: db1,
    DB: {
      prepare(q) {
        return {
          args: [],
          bind(...args) {
            this.args = args;
            return this;
          },
          async first() {
            return sql.prepare(q).get(...this.args) ?? null;
          },
          async run() {
            return sql.prepare(q).run(...this.args);
          },
        };
      },
    },
  };
}
let mode = "ok",
  calls = 0,
  queries = [];
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  mode = "ok";
  calls = 0;
  queries = [];
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(
      options.headers.Authorization,
      "Bearer private-analytics-token",
    );
    if (String(url).endsWith("/graphql")) {
      const body = JSON.parse(options.body);
      queries.push(body);
      if (body.query.includes("HealthWorkers")) {
        if (mode === "permission")
          return Response.json(
            { errors: [{ message: "private-analytics-token secret failure" }] },
            { status: 403 },
          );
        if (mode === "malformed")
          return Response.json({
            data: {
              viewer: {
                accounts: [
                  {
                    total: [{ sum: { requests: null, errors: 0 } }],
                    workers: [],
                    hourly: [],
                  },
                ],
              },
            },
          });
        if (mode === "empty")
          return Response.json({
            data: {
              viewer: { accounts: [{ total: [], workers: [], hourly: [] }] },
            },
          });
        return Response.json({
          data: {
            viewer: {
              accounts: [
                {
                  total: [{ sum: { requests: 85000, errors: 5 } }],
                  workers: [
                    {
                      dimensions: { scriptName: "beauty-app", status: "ok" },
                      sum: { requests: 1000, errors: 0 },
                    },
                    {
                      dimensions: {
                        scriptName: "another-project",
                        status: "exception",
                      },
                      sum: { requests: 84000, errors: 5 },
                    },
                  ],
                  hourly: [
                    {
                      dimensions: {
                        datetimeHour:
                          new Date().toISOString().slice(0, 13) + ":00:00Z",
                      },
                      sum: { requests: 85000, errors: 5 },
                    },
                  ],
                },
              ],
            },
          },
        });
      }
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                total: [
                  {
                    sum: {
                      rowsRead: 4500000,
                      rowsWritten: 120000,
                      readQueries: 12,
                      writeQueries: 3,
                    },
                  },
                ],
                databases: [
                  {
                    dimensions: { databaseId: db1 },
                    sum: {
                      rowsRead: 100,
                      rowsWritten: 10,
                      readQueries: 2,
                      writeQueries: 1,
                    },
                    quantiles: { queryBatchTimeMsP90: 2.5 },
                  },
                  {
                    dimensions: { databaseId: db2 },
                    sum: {
                      rowsRead: 4499900,
                      rowsWritten: 119990,
                      readQueries: 10,
                      writeQueries: 2,
                    },
                    quantiles: { queryBatchTimeMsP90: 12 },
                  },
                ],
                hourly: [],
              },
            ],
          },
        },
      });
    }
    if (String(url).includes("?per_page="))
      return Response.json({
        success: true,
        result: [
          { uuid: db1, name: "beauty-content-test" },
          { uuid: db2, name: "other-db" },
        ],
        result_info: { total_count: mode === "truncated" ? 3 : 2 },
      });
    if (mode === "storage-failure" && String(url).includes(db2))
      return Response.json({}, { status: 403 });
    return Response.json({
      success: true,
      result: {
        name: String(url).includes(db1) ? "beauty-content-test" : "other-db",
        file_size: String(url).includes(db1) ? 400000000 : 1000000000,
      },
    });
  };
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
});
const expire = (e) =>
  e.sql
    .prepare("UPDATE billing_snapshots SET attempted_at=?")
    .run(new Date(Date.now() - 3600000).toISOString());
test("残量は未取得・ゼロ・80%・超過を区別し負の残量を出さない", () => {
  assert.equal(quota(null, 100).remaining, null);
  assert.equal(quota(0, 100).remaining, 100);
  assert.equal(quota(80, 100).state, "warning");
  assert.equal(quota(120, 100).remaining, 0);
  assert.equal(quota(120, 100).percent, 120);
});
test("アカウント全体の集計から無料枠を計算しDB処理時間と容量を分離する", async () => {
  const e = env();
  try {
    const d = await syncHealth(e);
    assert.equal(d.ok, true);
    assert.equal(d.quotas.workers.used, 85000);
    assert.equal(d.quotas.workers.remaining, 15000);
    assert.equal(d.quotas.reads.remaining, 500000);
    assert.equal(d.quotas.writes.remaining, 0);
    assert.equal(d.quotas.storage.used, 1400000000);
    assert.equal(d.segments.d1.data.databases[0].p90_ms, 2.5);
    assert.equal(d.segments.workers.data.workers.length, 2);
    assert.equal(d.reset_at.slice(11), "00:00:00.000Z");
    assert.equal(queries[0].variables.start.slice(11), "00:00:00.000Z");
    assert.doesNotMatch(queries[0].query, /scriptName:/);
    assert.equal(queries[1].variables.day, d.day);
    assert.doesNotMatch(JSON.stringify(d), /private-analytics-token/);
    assert.doesNotMatch(
      e.sql.prepare("SELECT payload FROM billing_snapshots").get().payload,
      /private-analytics-token/,
    );
  } finally {
    e.sql.close();
  }
});
test("取得失敗で前回成功値と取得日時を保持し生エラーやキーを返さない", async () => {
  const e = env();
  try {
    const before = await syncHealth(e);
    expire(e);
    mode = "permission";
    const d = await syncHealth(e);
    assert.equal(d.ok, false);
    assert.equal(d.segments.workers.data.requests, 85000);
    assert.equal(
      d.segments.workers.fetched_at,
      before.segments.workers.fetched_at,
    );
    assert.equal(d.segments.workers.stale, true);
    assert.equal(d.segments.workers.error_code, "monitor_permission_denied");
    assert.equal(d.segments.d1.error_code, null);
    assert.doesNotMatch(
      JSON.stringify(d),
      /private-analytics-token|secret failure/,
    );
  } finally {
    e.sql.close();
  }
});
test("UTC日付をまたいだ古い値を今日の残量に使用しない", async () => {
  const e = env();
  try {
    await syncHealth(e);
    const old = JSON.parse(
      e.sql.prepare("SELECT payload FROM billing_snapshots").get().payload,
    );
    old.day = "2026-01-01";
    e.sql
      .prepare("UPDATE billing_snapshots SET payload=?")
      .run(JSON.stringify(old));
    const d = await healthOverview(e, false);
    assert.equal(d.quotas.workers.used, null);
    assert.equal(d.quotas.reads.used, null);
    assert.equal(d.quotas.storage.used, 1400000000);
    assert.equal(d.segments.workers.stale, true);
    expire(e);
    mode = "permission";
    assert.equal((await syncHealth(e)).quotas.workers.used, null);
  } finally {
    e.sql.close();
  }
});
test("有効な空集計はゼロ、不正な応答と未設定は未取得として扱う", async () => {
  const a = env(),
    b = env(),
    c = env();
  try {
    mode = "empty";
    assert.equal((await syncHealth(a)).quotas.workers.used, 0);
    mode = "malformed";
    const bad = await syncHealth(b);
    assert.equal(bad.quotas.workers.remaining, null);
    assert.equal(bad.segments.workers.error_code, "monitor_response_invalid");
    delete c.CLOUDFLARE_ANALYTICS_TOKEN;
    const before = calls;
    const d = await healthOverview(c);
    assert.equal(d.configured, false);
    assert.equal(d.quotas.workers.used, null);
    assert.equal(calls, before);
  } finally {
    a.sql.close();
    b.sql.close();
    c.sql.close();
  }
});
test("5分のキャッシュと1分の取得制限で呼びすぎを防ぐ", async () => {
  const e = env();
  try {
    await healthOverview(e);
    const before = calls;
    await healthOverview(e);
    assert.equal(calls, before);
    await assert.rejects(
      syncHealth(e),
      (error) => error.code === "monitor_sync_wait",
    );
    assert.equal(calls, before);
  } finally {
    e.sql.close();
  }
});
for (const scenario of ["storage-failure", "truncated"])
  test("容量が一部取得の場合は全体残量を計算しない: " + scenario, async () => {
    const e = env();
    try {
      mode = scenario;
      const d = await syncHealth(e);
      assert.equal(d.segments.storage.data.complete, false);
      assert.equal(d.quotas.storage.remaining, null);
      assert.equal(d.segments.storage.data.databases[0].bytes, 400000000);
    } finally {
      e.sql.close();
    }
  });
test("HTTP 5xxを集計しDB障害時に元の応答を妨げない", async () => {
  const e = env();
  try {
    await recordHttpFailure(e);
    await recordHttpFailure(e);
    assert.equal((await healthOverview(e, false)).local_http_errors, 2);
    await assert.doesNotReject(
      recordHttpFailure({
        DB: {
          prepare() {
            throw Error("DB unavailable");
          },
        },
      }),
    );
  } finally {
    e.sql.close();
  }
});
