import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { adminPage } from "../worker/admin.mjs";
const script = await readFile(
  new URL("../public/admin-billing.js", import.meta.url),
  "utf8",
);
const settle = async () => {
  for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
};
const overview = {
  pricing_date: "2026-10-13",
  local: {
    scope: "ローカル集計",
    daily: {
      calls: 5,
      call_limit: 30,
      reserved_tokens: 10000,
      token_limit: 600000,
    },
    models: [
      {
        model: "<img src=x onerror=alert(1)>",
        calls: 1,
        input_tokens: null,
        output_tokens: null,
        unknown_calls: 1,
        estimate: null,
      },
    ],
    calls: [],
  },
  cursor: {
    status: "imported",
    fetched_at: "2026-10-13T00:00:00Z",
    first_event_at: "2026-10-01T00:00:00Z",
    last_event_at: "2026-10-13T00:00:00Z",
    note: "CSVは実請求・残量ではありません",
    groups: [
      {
        type: "included",
        cost_usd: 1,
        calls: 1,
        total_tokens: 100,
        unknown_token_rows: 0,
        unknown_cost_rows: 0,
      },
    ],
    link: "https://cursor.com/dashboard",
  },
  gemini: {
    tier: "unknown",
    note: "APIの契約は未確認",
    link: "https://aistudio.google.com/usage",
  },
  cloudflare: {
    can_sync: false,
    status: "not_configured",
    fetched_at: null,
    entries: [],
    complete: false,
    note: "アカウント全体の請求履歴",
  },
  services: [
    {
      name: "Workers AI",
      allowance: "10,000 Neurons / 日",
      reset: "09:00",
      condition: "Freeでは超過すると停止",
      link: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    },
  ],
};
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
test("Billing panel is owner-only, labels unknown values, separates CSV spend and escapes model names", async () => {
  const w = window();
  try {
    w.document.write(adminPage());
    w.fetch = async (url) =>
      Response.json(String(url).endsWith("/me") ? { role: "admin" } : overview);
    w.eval(script);
    await settle();
    const root = w.document.getElementById("billing-tools");
    assert.equal(root.hidden, false);
    root.open = true;
    root.dispatchEvent(new w.Event("toggle"));
    await settle();
    assert.match(root.textContent, /未確認/);
    assert.match(root.textContent, /CSVの金額/);
    assert.match(root.textContent, /公式Spendingで確認/);
    assert.match(root.textContent, /未取得/);
    assert.equal(w.document.querySelector("#billing-models img"), null);
    assert.match(
      w.document.getElementById("billing-models").textContent,
      /<img/,
    );
    assert.equal(w.document.getElementById("billing-sync").disabled, true);
    assert.equal(root.hasAttribute("aria-busy"), false);
  } finally {
    await w.happyDOM.close();
  }
});
test("Editor cannot see the billing panel or trigger billing data requests", async () => {
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
    assert.equal(w.document.getElementById("billing-tools").hidden, true);
    assert.equal(calls, 1);
  } finally {
    await w.happyDOM.close();
  }
});
test("Cursor import requires explicit replacement and preserves retry input on API errors", async () => {
  const w = window();
  try {
    w.document.write(adminPage());
    let posted = null,
      fail = true;
    w.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/me")) return Response.json({ role: "admin" });
      if (options.method === "POST") {
        posted = JSON.parse(options.body);
        return fail
          ? Response.json(
              { error: { code: "cursor_csv_columns_required" } },
              { status: 400 },
            )
          : Response.json({ unchanged: false, rows: 2 });
      }
      return Response.json(overview);
    };
    w.eval(script);
    await settle();
    const file = new w.File(["Date,Type,Cost"], "usage.csv", {
      type: "text/csv",
    });
    w.document.getElementById("cursor-csv").files = [file];
    const form = w.document.getElementById("cursor-import");
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(posted, null);
    w.document.getElementById("cursor-replace").checked = true;
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(posted.replace_confirmed, true);
    assert.match(
      w.document.getElementById("billing-message").textContent,
      /列が必要/,
    );
    assert.equal(w.document.getElementById("cursor-replace").checked, true);
    fail = false;
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.match(
      w.document.getElementById("billing-message").textContent,
      /2件の利用履歴/,
    );
    assert.equal(w.document.getElementById("cursor-replace").checked, false);
  } finally {
    await w.happyDOM.close();
  }
});
