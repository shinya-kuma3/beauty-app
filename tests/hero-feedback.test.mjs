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
test("ヒーローは6秒で自動切り替えし、非表示タブと動きを減らす設定では停止する", async () => {
  const w = win();
  try {
    w.document.write(
      "<div data-hero-carousel>" +
        Array.from(
          { length: 5 },
          (_, i) =>
            '<div data-scene class="' +
            (i === 0 ? "is-active" : "") +
            '"></div><span data-hero-progress class="' +
            (i === 0 ? "is-active" : "") +
            '"><i></i></span>',
        ).join("") +
        "</div>",
    );
    let callback,
      delay,
      cleared = 0;
    w.setTimeout = (fn, ms) => {
      callback = fn;
      delay = ms;
      return 1;
    };
    w.clearTimeout = () => cleared++;
    const motion = {
      matches: false,
      addEventListener(_event, fn) {
        this.changed = fn;
      },
    };
    w.matchMedia = () => motion;
    Object.defineProperty(w.document, "hidden", {
      value: false,
      configurable: true,
    });
    w.eval(hero);
    assert.equal(delay, 6000);
    callback();
    assert.equal(
      w.document
        .querySelectorAll("[data-scene]")[1]
        .getAttribute("aria-hidden"),
      "false",
    );
    assert.equal(
      w.document
        .querySelectorAll("[data-hero-progress]")[1]
        .classList.contains("is-active"),
      true,
    );
    assert.equal(w.document.querySelector("button"), null);
    motion.matches = true;
    motion.changed();
    assert.equal(
      w.document.querySelector("[data-hero-carousel]").dataset.running,
      "false",
    );
    assert.ok(cleared > 0);
    motion.matches = false;
    motion.changed();
    assert.equal(
      w.document.querySelector("[data-hero-carousel]").dataset.running,
      "true",
    );
    Object.defineProperty(w.document, "hidden", {
      value: true,
      configurable: true,
    });
    w.document.dispatchEvent(new w.Event("visibilitychange"));
    assert.equal(
      w.document.querySelector("[data-hero-carousel]").dataset.running,
      "false",
    );
  } finally {
    await w.happyDOM.close();
  }
});

test("意見箱は検証前に送信できず、失敗時も入力を残して再送のUUIDを保つ", async () => {
  const w = win();
  try {
    w.document.write(
      '<form id="feedback-form" data-api="https://api.example/api/feedback"><input name="name"><input name="email"><textarea name="message"></textarea><input name="company_website"><button id="feedback-submit" disabled></button></form><div id="feedback-challenge"></div><p id="feedback-status"></p><p id="feedback-count"></p><dialog id="feedback-thanks"><h2>ご意見、ありがとうございます。</h2><span id="feedback-redirect-count">3</span><a id="feedback-home" href="/">TOPへ戻る</a></dialog>',
    );
    let callbacks,
      calls = [],
      resets = 0;
    let tick, redirect;
    w.setInterval = (fn) => {
      tick = fn;
      return 1;
    };
    w.clearInterval = () => {};
    w.location.assign = (url) => {
      redirect = url;
    };
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
    assert.equal(w.document.getElementById("feedback-thanks").open, false);
    assert.equal(resets, 1);
    callbacks.callback("new-token");
    form.dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
    assert.equal(calls[0].id, calls[1].id);
    assert.equal(form.elements.message.value, "");
    assert.equal(w.document.getElementById("feedback-thanks").open, true);
    assert.equal(w.document.activeElement.id, "feedback-home");
    tick();
    assert.equal(
      w.document.getElementById("feedback-redirect-count").textContent,
      "2",
    );
    tick();
    assert.equal(redirect, undefined);
    tick();
    assert.equal(
      redirect,
      "https://develop-beauty-app.sinyak4649.workers.dev/",
    );
    assert.equal(w.document.getElementById("feedback-submit").disabled, true);
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
        assert.equal(
          w.document.getElementById("feedback-unread").textContent,
          "1",
        );
        assert.equal(
          w.document.getElementById("feedback-unread").hidden,
          false,
        );
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

test("未確認の投稿が0件なら通知の数字を非表示にする", async () => {
  const w = win();
  try {
    w.document.write(adminPage());
    w.fetch = async (url) =>
      Response.json(
        String(url).endsWith("/me")
          ? { role: "admin" }
          : { items: [], unread: 0, total: 0 },
      );
    w.eval(admin);
    await settle();
    assert.equal(w.document.getElementById("feedback-unread").hidden, true);
  } finally {
    await w.happyDOM.close();
  }
});
