import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { adminPage } from "../worker/admin.mjs";
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
const hero = await read("public/hero-carousel.js"),
  feedback = await read("public/feedback.js"),
  admin = await read("public/admin-feedback.js");
const settle = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
function win() {
  return new Window({
    url: "https://develop-beauty-app.sinyak4649.workers.dev",
    settings: {
      enableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
}
test("ヒーローは5場面を手動選択でき、キーボードと動きを減らす設定に対応", async () => {
  const w = win();
  try {
    w.document.write(
      "<div data-hero-carousel>" +
        Array.from(
          { length: 5 },
          (_, i) =>
            '<div data-scene class="' +
            (i === 0 ? "is-active" : "") +
            '"></div><button data-hero-dot></button>',
        ).join("") +
        "<button data-hero-pause></button></div>",
    );
    w.matchMedia = () => ({ matches: true, addEventListener() {} });
    w.eval(hero);
    const dots = w.document.querySelectorAll("[data-hero-dot]");
    dots[3].click();
    assert.equal(dots[3].getAttribute("aria-pressed"), "true");
    assert.equal(
      w.document
        .querySelectorAll("[data-scene]")[0]
        .getAttribute("aria-hidden"),
      "true",
    );
    assert.equal(w.document.querySelector("[data-hero-pause]").disabled, true);
    dots[3].dispatchEvent(new w.KeyboardEvent("keydown", { key: "End" }));
    assert.equal(dots[4].getAttribute("aria-pressed"), "true");
  } finally {
    await w.happyDOM.close();
  }
});
test("意見箱は検証前に送信できず、失敗時も入力を残して再送のUUIDを保つ", async () => {
  const w = win();
  try {
    w.document.write(
      '<form id="feedback-form" data-api="https://api.example/api/feedback"><input name="name"><input name="email"><textarea name="message"></textarea><input name="company_website"><button id="feedback-submit" disabled></button></form><div id="feedback-challenge"></div><p id="feedback-status"></p><p id="feedback-count"></p>',
    );
    let callbacks,
      calls = [],
      resets = 0;
    w.turnstile = {
      render(_target, options) {
        callbacks = options;
        return 0;
      },
      reset() {
        resets++;
      },
    };
    w.fetch = async (_url, options) => {
      if (!options?.method)
        return Response.json({ enabled: true, sitekey: "site" });
      calls.push(JSON.parse(options.body));
      return calls.length === 1
        ? Response.json(
            { error: { code: "feedback_verification_failed" } },
            { status: 400 },
          )
        : Response.json({ ok: true }, { status: 201 });
    };
    w.eval(feedback);
    await settle();
    w.document.querySelector("script").dispatchEvent(new w.Event("load"));
    const form = w.document.getElementById("feedback-form");
    form.elements.message.value = "改善案";
    assert.equal(w.document.getElementById("feedback-submit").disabled, true);
    callbacks.callback("token");
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(form.elements.message.value, "改善案");
    assert.equal(resets, 1);
    callbacks.callback("new-token");
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(calls[0].id, calls[1].id);
    assert.equal(form.elements.message.value, "");
    assert.match(
      w.document.getElementById("feedback-status").textContent,
      /受け付け/,
    );
  } finally {
    await w.happyDOM.close();
  }
});
test("管理意見箱は編集者に表示せず、投稿本文をHTMLとして実行しない", async () => {
  for (const role of ["editor", "admin"]) {
    const w = win();
    try {
      w.document.write(adminPage());
      w.confirm = () => true;
      const calls = [];
      w.fetch = async (url) => {
        calls.push(url);
        return String(url).endsWith("/me")
          ? Response.json({ role })
          : Response.json({
              items: [
                {
                  id: "one",
                  name: "<img src=x onerror=alert(1)>",
                  email: null,
                  message: "<script>attack()</script>",
                  status: "new",
                  created_at: "2026-10-13T00:00:00Z",
                },
              ],
              total: 1,
              unread: 1,
            });
      };
      w.eval(admin);
      await settle();
      assert.equal(
        w.document.getElementById("feedback-tools").hidden,
        role !== "admin",
      );
      if (role === "editor") assert.equal(calls.length, 1);
      else {
        assert.equal(w.document.querySelector("#feedback-list img"), null);
        assert.match(
          w.document.querySelector(".feedback-body").textContent,
          /script/,
        );
      }
    } finally {
      await w.happyDOM.close();
    }
  }
});
