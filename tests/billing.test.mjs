import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  parseCursorCsv,
  importCursor,
  billingOverview,
  syncCloudflare,
  monthRange,
  estimateModel,
} from "../worker/billing.mjs";
const csv =
  'Date,Type,Model,Total Tokens,Cost,User\r\n2026-10-12T09:00:00Z,Included,grok,1000,$0.012,private@example.test\r\n2026-10-13T09:00:00Z,On-Demand,"model, quoted",2000,0.10,private@example.test\r\n';
function env() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(
      new URL("../migrations/0001_content_pipeline.sql", import.meta.url),
      "utf8",
    ),
  );
  sql.exec(
    readFileSync(
      new URL("../migrations/0008_billing_dashboard.sql", import.meta.url),
      "utf8",
    ),
  );
  return {
    sql,
    PIPELINE_ENV: "development",
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
          async all() {
            return { results: sql.prepare(q).all(...this.args) };
          },
          async run() {
            return sql.prepare(q).run(...this.args);
          },
        };
      },
    },
  };
}
test("Cursor CSV correctly distinguishes included, on-demand, unknown costs and UTC months", () => {
  const result = parseCursorCsv(csv);
  assert.equal(result.rows, 2);
  assert.equal(result.groups[0].type, "included");
  assert.equal(result.groups[1].type, "on_demand");
  assert.equal(result.groups[1].model, "model, quoted");
  assert.equal(result.groups[1].cost_usd, 0.1);
  const missing = parseCursorCsv(
    "Date,Type,Cost\n2026-10-01T00:30:00+09:00,Unfamiliar,\n",
  );
  assert.equal(missing.groups[0].month, "2026-09");
  assert.equal(missing.groups[0].type, "other");
  assert.equal(missing.groups[0].unknown_cost_rows, 1);
  assert.equal(missing.groups[0].unknown_token_rows, 1);
  const aliases = parseCursorCsv(
    "Date,Kind,Input Tokens (with Cache Write),Input Tokens (without Cache Write),Cache Read Tokens,Output Tokens,Cost\n2026-10-01T00:00:00Z,Usage-based,100,200,300,400,0.5",
  );
  assert.equal(aliases.groups[0].total_tokens, 1000);
  assert.equal(aliases.groups[0].type, "on_demand");
});
test("Malformed CSV, missing columns, ambiguous dates and invalid money fail without zero-valued conversion", () => {
  for (const value of [
    "Date,Cost\n2026-10-01T00:00:00Z,1",
    "Date,Type,Cost\n2026-10-01,Included,1",
    "Date,Type,Cost\n2026-10-01T00:00:00Z,Included,NaN",
    'Date,Type,Cost\n2026-10-01T00:00:00Z,Included,"oops',
  ])
    assert.throws(() => parseCursorCsv(value));
  assert.throws(() => parseCursorCsv("a".repeat(1500001)));
  assert.throws(() => monthRange("2026-13"));
  assert.equal(monthRange("2026-12").end, "2027-01-01");
});
test("Cursor imports replace rather than add, deduplicate identical imports and retain only private aggregates", async () => {
  const e = env();
  try {
    assert.equal((await importCursor(e, csv)).unchanged, false);
    assert.equal((await importCursor(e, csv)).unchanged, true);
    let dashboard = await billingOverview(e, "2026-10");
    assert.equal(
      dashboard.cursor.groups.reduce((s, r) => s + r.calls, 0),
      2,
    );
    assert.equal(dashboard.cursor.remaining, null);
    assert.doesNotMatch(
      e.sql.prepare("SELECT payload FROM billing_snapshots").get().payload,
      /private@example/,
    );
    assert.equal(dashboard.gemini.tier, "unknown");
    assert.equal(dashboard.cloudflare.status, "not_configured");
    assert.equal(dashboard.cloudflare.entries.length, 0);
    await importCursor(e, "Date,Type,Cost\n2026-09-01T00:00:00Z,Included,0.5");
    dashboard = await billingOverview(e, "2026-10");
    assert.equal(dashboard.cursor.groups.length, 0);
  } finally {
    e.sql.close();
  }
});
test("Failed/billed calls remain visible, budget reservations never become measured tokens or precise invoices", async () => {
  const e = env();
  try {
    e.sql.exec(
      `INSERT INTO ai_usage(id,day,provider,model,input_tokens,output_tokens,reserved_tokens,usage_estimated,outcome,created_at) VALUES('a','2026-10-01','gemini','gemini-3.1-flash-lite',100,80,30000,0,'failed','2026-10-01'),('b','2026-10-01','workers','@cf/baai/bge-m3',NULL,NULL,20000,1,'success','2026-10-01');`,
    );
    const data = await billingOverview(e, "2026-10");
    assert.equal(data.local.models[0].input_tokens, 100);
    assert.equal(data.local.models[0].failed_calls, 1);
    assert.equal(data.local.models[1].input_tokens, null);
    assert.equal(data.local.models[1].unknown_calls, 1);
    assert.equal(data.local.models[1].estimate, null);
    const price = estimateModel(data.local.models[0]);
    assert.ok(price.maximum > price.minimum);
    assert.equal(
      estimateModel({
        provider: "gemini",
        model: "unknown",
        input_tokens: 100,
        output_tokens: 100,
      }),
      null,
    );
    assert.equal(data.gemini.invoice, null);
  } finally {
    e.sql.close();
  }
});
test("Cloudflare billing uses read-only API, pagination, private normalization, stale fallback and fetch throttling", async () => {
  const e = env(),
    original = globalThis.fetch;
  e.CLOUDFLARE_BILLING_TOKEN = "secret-billing-token";
  e.CLOUDFLARE_BILLING_ACCOUNT_ID = "a".repeat(32);
  try {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(options.method, undefined);
      assert.match(url, /billing\/history/);
      assert.equal(
        options.headers.Authorization,
        "Bearer secret-billing-token",
      );
      return Response.json({
        success: true,
        result: [
          {
            amount: 20.99,
            currency: "USD",
            occurred_at: "2026-10-01T12:00:00Z",
            status: "paid",
            type: "charge",
            hosted_invoice_url: "https://private-invoice.test",
            description: "Private name",
          },
        ],
        result_info: { total_count: 1 },
      });
    };
    assert.equal((await syncCloudflare(e)).ok, true);
    const data = await billingOverview(e, "2026-10");
    assert.equal(calls, 1);
    assert.equal(data.cloudflare.entries[0].amount, 20.99);
    assert.equal(data.cloudflare.complete, true);
    assert.doesNotMatch(
      JSON.stringify(data),
      /secret-billing-token|private-invoice|Private name/,
    );
    await assert.rejects(
      syncCloudflare(e),
      (err) => err.code === "billing_sync_wait",
    );
    e.sql.exec(`UPDATE billing_snapshots SET attempted_at='2020-01-01';`);
    globalThis.fetch = async () =>
      new Response("PRIVATE error and token", { status: 403 });
    const fallback = await billingOverview(e, "2026-10");
    assert.equal(fallback.cloudflare.status, "error");
    assert.equal(fallback.cloudflare.entries[0].amount, 20.99);
    assert.equal(fallback.cloudflare.error_code, "billing_permission_denied");
    assert.doesNotMatch(JSON.stringify(fallback), /PRIVATE/);
  } finally {
    globalThis.fetch = original;
    e.sql.close();
  }
});
