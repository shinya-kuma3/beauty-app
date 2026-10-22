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
test("意見箱は編集者に本文だけを表示し、確認・削除と個人情報は管理者だけ、本文をHTMLとして実行しない", async () => {
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
                  email: "reader@example.test",
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
      assert.equal(w.document.getElementById("feedback-tools").hidden, false);
      assert.equal(w.document.querySelector("#feedback-list img"), null);
      assert.match(
        w.document.querySelector(".feedback-body").textContent,
        /script/,
      );
      if (role === "editor") {
        const card = w.document.querySelector(".feedback-card");
        assert.equal(card.querySelector("h3").textContent, "読者からの投稿");
        assert.equal(card.querySelector(".feedback-email"), null);
        assert.equal(card.querySelector("button"), null);
        assert.doesNotMatch(card.textContent, /reader@example\.test/);
      } else {
        assert.match(
          w.document.querySelector(".feedback-email").textContent,
          /reader@example\.test/,
        );
        assert.ok(w.document.querySelector(".feedback-card .danger"));
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

test("意見箱は表示数とページ移動を連動し、最後の投稿削除後は前のページへ戻る", async () => {
  const w = win();
  try {
    w.document.write(adminPage());
    w.confirm = () => true;
    let rows = Array.from({ length: 21 }, (_, i) => ({
      id: "post-" + i,
      name: "投稿" + i,
      message: "本文" + i,
      status: "new",
      created_at: "2026-10-13T00:00:00Z",
    }));
    const calls = [];
    let fail = false;
    w.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/me")) return Response.json({ role: "admin" });
      if (options.method === "DELETE") {
        rows = rows.filter((row) => !String(url).endsWith("/" + row.id));
        return Response.json({ ok: true });
      }
      const query = new URL(url, "https://example.test").searchParams;
      calls.push({
        offset: Number(query.get("offset")),
        limit: Number(query.get("limit")),
        status: query.get("status"),
      });
      if (fail) return Response.json({}, { status: 500 });
      const items = query.get("status") === "read" ? [] : rows;
      return Response.json({
        items: items.slice(
          Number(query.get("offset")),
          Number(query.get("offset")) + Number(query.get("limit")),
        ),
        total: items.length,
        unread: rows.length,
      });
    };
    const $ = (id) => w.document.getElementById(id);
    w.eval(admin);
    await settle();
    assert.equal(w.document.querySelectorAll(".feedback-card").length, 10);
    assert.equal($("feedback-prev").disabled, true);
    assert.equal($("feedback-next").disabled, false);
    assert.match($("feedback-page-info").textContent, /1–10件.*全21件/);
    $("feedback-next").click();
    await settle();
    assert.equal(calls.at(-1).offset, 10);
    assert.match($("feedback-page-info").textContent, /11–20件/);
    $("feedback-limit").value = "20";
    $("feedback-limit").dispatchEvent(new w.Event("change"));
    await settle();
    assert.equal(calls.at(-1).offset, 0);
    assert.equal(calls.at(-1).limit, 20);
    assert.equal(w.document.querySelectorAll(".feedback-card").length, 20);
    $("feedback-next").click();
    await settle();
    assert.equal(w.document.querySelectorAll(".feedback-card").length, 1);
    assert.equal($("feedback-next").disabled, true);
    w.document.querySelector(".feedback-card .danger").click();
    await settle();
    assert.equal(calls.at(-1).offset, 0);
    assert.equal(w.document.querySelectorAll(".feedback-card").length, 20);
    assert.equal($("feedback-prev").disabled, true);
    assert.equal($("feedback-next").disabled, true);
    $("feedback-limit").value = "10";
    $("feedback-limit").dispatchEvent(new w.Event("change"));
    await settle();
    fail = true;
    $("feedback-next").click();
    await settle();
    assert.equal(w.document.querySelectorAll(".feedback-card").length, 10);
    assert.match($("feedback-page-info").textContent, /1–10件/);
    assert.match($("feedback-message").textContent, /取得・更新できません/);
    assert.equal($("feedback-prev").disabled, true);
    fail = false;
    $("feedback-status").value = "read";
    $("feedback-status").dispatchEvent(new w.Event("change"));
    await settle();
    assert.equal(calls.at(-1).offset, 0);
    assert.equal($("feedback-pagination").hidden, true);
    assert.equal($("feedback-page-info").textContent, "全0件");
  } finally {
    await w.happyDOM.close();
  }
});
