import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { siteAnalytics, pageAnalytics } from "../worker/analytics.mjs";
import { adminPage } from "../worker/admin.mjs";

const zone = "b".repeat(32);
function env(overrides = {}) {
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
  sql.exec("CREATE TABLE articles(slug TEXT, title TEXT)");
  sql
    .prepare("INSERT INTO articles(slug,title) VALUES(?,?)")
    .run("autumn-hand-cream", "秋冬ハンドクリーム");
  return {
    sql,
    CLOUDFLARE_ANALYTICS_TOKEN: "private-analytics-token",
    CLOUDFLARE_ANALYTICS_ZONE_ID: zone,
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
          async all() {
            return { results: sql.prepare(q).all(...this.args) };
          },
        };
      },
    },
    ...overrides,
  };
}
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) =>
  new Date(Date.parse(today() + "T00:00:00Z") - n * 86400000)
    .toISOString()
    .slice(0, 10);
let mode = "ok",
  queries = [];
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  mode = "ok";
  queries = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.cloudflare.com/client/v4/graphql");
    assert.equal(options.headers.Authorization, "Bearer private-analytics-token");
    const body = JSON.parse(options.body);
    queries.push(body);
    assert.equal(body.variables.zoneTag, zone);
    if (mode === "permission") return Response.json({}, { status: 403 });
    if (mode === "range")
      return Response.json({
        data: null,
        errors: [
          {
            message:
              "cannot request data older than 3d; token private-analytics-token " +
              "x".repeat(40),
          },
        ],
      });
    if (body.query.includes("SiteDaily"))
      return Response.json({
        data: {
          viewer: {
            zones: [
              {
                days: [
                  {
                    dimensions: { date: daysAgo(6) },
                    sum: { requests: 900, pageViews: 120 },
                    uniq: { uniques: 40 },
                  },
                  {
                    dimensions: { date: today() },
                    sum: { requests: 300, pageViews: 50 },
                    uniq: { uniques: 20 },
                  },
                ],
              },
            ],
          },
        },
      });
    return Response.json({
      data: {
        viewer: {
          zones: [
            {
              pages: [
                { count: 30, dimensions: { clientRequestPath: "/articles/autumn-hand-cream/" } },
                { count: 4, dimensions: { clientRequestPath: "/articles/autumn-hand-cream" } },
                { count: 9, dimensions: { clientRequestPath: "/articles/nail-care-basics/" } },
                { count: 99, dimensions: { clientRequestPath: "/articles/" } },
                { count: 50, dimensions: { clientRequestPath: "/articles/../admin" } },
              ],
            },
          ],
        },
      },
    });
  };
});
test.after(() => {
  globalThis.fetch = realFetch;
});

test("日別のアクセスは期間の全日を返し、取得できない日を0にせず、15分は再取得しない", async () => {
  const e = env();
  const result = await siteAnalytics(e, { days: "7" });
  assert.equal(result.configured, true);
  assert.equal(result.error_code, null);
  assert.equal(result.data.series.length, 7);
  assert.equal(result.data.series[0].date, daysAgo(6));
  assert.deepEqual(result.data.series[0], {
    date: daysAgo(6),
    requests: 900,
    page_views: 120,
    visitors: 40,
  });
  assert.equal(result.data.series[3].page_views, null);
  assert.equal(result.data.series.at(-1).page_views, 50);
  assert.match(queries[0].query, /httpRequests1dGroups/);
  assert.match(queries[0].query, new RegExp('date_geq: "' + daysAgo(6) + '"'));
  await siteAnalytics(e, { days: "7" });
  assert.equal(queries.length, 1);
  await assert.rejects(siteAnalytics(e, { days: "14" }), { code: "invalid_period" });
});

test("未設定なら取得せず、権限エラーは前回値を残して原因を返す", async () => {
  const off = await siteAnalytics(env({ CLOUDFLARE_ANALYTICS_ZONE_ID: "" }), {});
  assert.equal(off.configured, false);
  assert.equal(off.data, null);
  assert.equal(queries.length, 0);
  const e = env();
  await siteAnalytics(e, { days: "30" });
  e.sql
    .prepare("UPDATE billing_snapshots SET fetched_at=?,attempted_at=?")
    .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
  mode = "permission";
  const result = await siteAnalytics(e, { days: "30" }, "admin");
  assert.equal(result.error_code, "analytics_permission_denied");
  assert.equal(result.stale, true);
  assert.equal(result.data.series.length, 30);
});

test("記事別の閲覧数は記事URLだけを合算し、範囲エラーの説明は管理者にだけキーを隠して返す", async () => {
  const e = env();
  const result = await pageAnalytics(e, { days: "7" });
  assert.match(queries[0].query, /httpRequestsAdaptiveGroups/);
  assert.match(queries[0].query, /clientRequestPath/);
  assert.deepEqual(result.data.pages, [
    {
      slug: "autumn-hand-cream",
      path: "/articles/autumn-hand-cream/",
      title: "秋冬ハンドクリーム",
      views: 34,
    },
    {
      slug: "nail-care-basics",
      path: "/articles/nail-care-basics/",
      title: null,
      views: 9,
    },
  ]);
  mode = "range";
  const editor = await pageAnalytics(env(), { days: "90", refresh: "1" }, "editor");
  assert.equal(editor.error_code, "analytics_query_failed");
  assert.equal(editor.provider_message, null);
  const admin = await pageAnalytics(env(), { days: "30", refresh: "1" }, "admin");
  assert.equal(admin.error_code, "analytics_query_failed");
  assert.match(admin.provider_message, /older than 3d/);
  assert.doesNotMatch(admin.provider_message, /private-analytics-token|x{32}/);
  await assert.rejects(pageAnalytics(env(), { days: "2" }), { code: "invalid_period" });
});

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}
function browser(path = "/admin") {
  return new Window({
    url: "https://example.test" + path,
    settings: {
      enableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
}
const shell = await readFile(new URL("../public/admin-shell.js", import.meta.url), "utf8");
const analytics = await readFile(new URL("../public/admin-analytics.js", import.meta.url), "utf8");

test("左メニューでページを切り替え、URLと表示中のページをそろえ、編集者には管理者用メニューを出さない", async () => {
  const w = browser("/admin");
  try {
    w.document.write(adminPage({ page: "dashboard" }));
    w.fetch = async () => Response.json({ role: "editor", email: "editor@example.test" });
    w.eval(shell);
    await settle();
    const $ = (id) => w.document.getElementById(id);
    const visible = () =>
      [...w.document.querySelectorAll(".admin-page")].filter((s) => !s.hidden).map((s) => s.dataset.page);
    assert.deepEqual(visible(), ["dashboard"]);
    assert.equal(w.document.querySelector('[data-nav="dashboard"]').getAttribute("aria-current"), "page");
    assert.ok([...w.document.querySelectorAll("[data-owner-only]")].every((item) => item.hidden));
    w.document.querySelector('[data-nav="articles"]').click();
    await settle();
    assert.deepEqual(visible(), ["articles"]);
    assert.equal(w.location.pathname, "/admin/articles");
    assert.match(w.document.title, /^記事/);
    assert.equal(w.document.querySelector('[data-nav="dashboard"]').hasAttribute("aria-current"), false);
    w.BeautyAdminNav.go("/admin/team");
    assert.deepEqual(visible(), ["dashboard"]);
    assert.ok($("analytics-chart"));
  } finally {
    await w.happyDOM.close();
  }
});

test("ページを開くと読み込みが必要なパネルを開き、管理者には管理者用メニューを表示する", async () => {
  const w = browser("/admin/usage");
  try {
    w.document.write(adminPage({ page: "usage", role: "admin" }));
    w.fetch = async () => Response.json({ role: "admin" });
    w.eval(shell);
    await settle();
    assert.equal(w.document.getElementById("billing-tools").open, true);
    assert.ok([...w.document.querySelectorAll("[data-owner-only]")].every((item) => !item.hidden));
    w.document.querySelector('[data-nav="dashboard"]').click();
    await settle();
    assert.equal(w.document.getElementById("health-tools").open, true);
  } finally {
    await w.happyDOM.close();
  }
});

function dailyResult(configured = true) {
  return {
    configured,
    days: 30,
    data: configured
      ? {
          start: daysAgo(2),
          end: today(),
          series: [
            { date: daysAgo(2), requests: 1000, page_views: 200, visitors: 80 },
            { date: daysAgo(1), requests: null, page_views: null, visitors: null },
            { date: today(), requests: 500, page_views: 100, visitors: 40 },
          ],
        }
      : null,
    fetched_at: configured ? new Date().toISOString() : null,
    error_code: null,
    provider_message: null,
    stale: false,
  };
}
test("ダッシュボードは合計・グラフ・表を表示し、取得できない日を0として扱わない", async () => {
  const w = browser("/admin");
  try {
    w.document.write(adminPage({ page: "dashboard" }));
    const calls = [];
    w.fetch = async (url) => {
      calls.push(String(url));
      return String(url).endsWith("/me") ? Response.json({ role: "editor" }) : Response.json(dailyResult());
    };
    w.eval(analytics);
    await settle();
    const $ = (id) => w.document.getElementById(id);
    assert.ok(calls.some((u) => u.endsWith("/api/admin/analytics?days=30")));
    assert.match($("analytics-tiles").textContent, /閲覧数300/);
    assert.match($("analytics-tiles").textContent, /訪問者数（延べ）120/);
    assert.match($("analytics-tiles").textContent, /リクエスト数1,500/);
    assert.ok($("analytics-chart").querySelector("svg"));
    assert.equal($("analytics-chart").querySelectorAll("path").length, 2);
    // The missing middle day splits each line instead of dropping to zero.
    assert.match($("analytics-chart").querySelector("path").getAttribute("d"), /^M.* M/);
    const rows = $("analytics-table").querySelectorAll("tr");
    assert.equal(rows.length, 4);
    assert.match(rows[2].textContent, /—/);
    assert.equal($("analytics-setup").hidden, true);
    w.document.querySelector('[data-analytics-days="7"]').click();
    await settle();
    assert.ok(calls.some((u) => u.endsWith("days=7")));
    assert.equal(w.document.querySelector('[data-analytics-days="7"]').getAttribute("aria-pressed"), "true");
  } finally {
    await w.happyDOM.close();
  }
});

test("未設定のとき管理者には設定手順、編集者には準備中と表示する", async () => {
  for (const role of ["admin", "editor"]) {
    const w = browser("/admin");
    try {
      w.document.write(adminPage({ page: "dashboard" }));
      w.fetch = async (url) =>
        String(url).endsWith("/me") ? Response.json({ role }) : Response.json(dailyResult(false));
      w.eval(analytics);
      await settle();
      assert.equal(w.document.getElementById("analytics-setup").hidden, role !== "admin");
      if (role === "editor")
        assert.match(w.document.getElementById("analytics-message").textContent, /準備中/);
      assert.equal(w.document.getElementById("analytics-chart").querySelector("svg"), null);
    } finally {
      await w.happyDOM.close();
    }
  }
});

test("記事別の閲覧数は選んだ期間で取得し、取得できない期間はCloudflareの説明を表示する", async () => {
  const w = browser("/admin");
  try {
    w.document.write(adminPage({ page: "dashboard" }));
    let pageMode = "ok";
    const calls = [];
    w.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/me")) return Response.json({ role: "admin" });
      if (String(url).includes("/analytics/pages"))
        return Response.json(
          pageMode === "ok"
            ? {
                configured: true,
                days: 7,
                data: {
                  start: "2026-10-15T00:00:00.000Z",
                  end: "2026-10-22T00:00:00.000Z",
                  pages: [{ slug: "a-b", path: "/articles/a-b/", title: "<b>記事</b>", views: 12 }],
                },
                error_code: null,
              }
            : {
                configured: true,
                days: 90,
                data: null,
                error_code: "analytics_query_failed",
                provider_message: "cannot request data older than 3d",
              },
        );
      return Response.json(dailyResult());
    };
    w.eval(analytics);
    await settle();
    const $ = (id) => w.document.getElementById(id);
    $("pages-days").value = "7";
    $("pages-load").click();
    await settle();
    assert.ok(calls.some((u) => u.endsWith("/api/admin/analytics/pages?refresh=1&days=7")), calls.join(" "));
    assert.match($("pages-message").textContent, /7日分を取得できました/);
    assert.equal($("pages-result").querySelector("b"), null);
    assert.match($("pages-result").textContent, /<b>記事<\/b>12/);
    assert.equal($("pages-result").querySelector("a").getAttribute("href"), "https://my-beauty-palette.com/articles/a-b/");
    pageMode = "range";
    $("pages-days").value = "90";
    $("pages-load").click();
    await settle();
    assert.match($("pages-message").textContent, /90日分は取得できませんでした/);
    assert.match($("pages-message").textContent, /older than 3d/);
  } finally {
    await w.happyDOM.close();
  }
});
