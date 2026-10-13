import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { adminPage } from "../worker/admin.mjs";
const script = await readFile(
  new URL("../public/admin-publications.js", import.meta.url),
  "utf8",
);
const settle = async () => {
  for (let i = 0; i < 10; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const entry = {
  slug: "moisturizer-basics",
  title: "保湿の基本",
  excerpt: "本文を保持したまま非公開にします。",
  origin: "initial",
  revision_token: "static:test",
};
test("編集者も初期記事を選べ、理由・確認付きの非公開操作だけを送信する", async () => {
  const w = new Window({
    url: "https://example.test/admin",
    settings: {
      enableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  try {
    w.document.write(adminPage());
    let posted = null,
      failed = true;
    w.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/me")) return Response.json({ role: "editor" });
      if (options.method === "POST") {
        posted = JSON.parse(options.body);
        return failed
          ? Response.json(
              { error: { code: "revision_conflict" } },
              { status: 409 },
            )
          : Response.json(
              { id: "request", state: "requested" },
              { status: 201 },
            );
      }
      return Response.json({ items: [entry], total: 1 });
    };
    w.eval(script);
    await settle();
    const $ = (id) => w.document.getElementById(id);
    assert.equal($("publication-tools").hidden, false);
    w.document.querySelector("#publication-list button").click();
    assert.equal($("withdraw-dialog").open, true);
    const form = $("withdraw-form");
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(posted, null);
    $("withdraw-reason").value = "出典を再確認";
    $("withdraw-confirm").checked = true;
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(posted.reason, "出典を再確認");
    assert.equal(posted.confirmed, true);
    assert.equal(posted.revision_token, entry.revision_token);
    assert.equal($("withdraw-dialog").open, true);
    assert.equal($("withdraw-reason").value, "出典を再確認");
    assert.match($("withdraw-error").textContent, /記事が更新/);
    failed = false;
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal($("withdraw-dialog").open, false);
    assert.match($("publication-message").textContent, /非公開を依頼/);
  } finally {
    await w.happyDOM.close();
  }
});
