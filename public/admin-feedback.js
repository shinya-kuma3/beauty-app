(() => {
  const root = document.getElementById("feedback-tools");
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  let page = 1,
    total = 0,
    limit = 10,
    status = "new",
    working = false,
    canManage = false;
  const el = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  async function api(path = "", method = "GET", body) {
    const response = await fetch("/api/admin/feedback" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(
        "投稿を取得・更新できませんでした。ログイン状態を確認して再度お試しください。",
      );
    return response.json();
  }
  function pagination() {
    const pages = Math.max(1, Math.ceil(total / limit));
    $("feedback-prev").disabled = working || page <= 1;
    $("feedback-next").disabled = working || page >= pages;
    const numbers = $("feedback-page-numbers");
    numbers.replaceChildren();
    const selected = [...new Set([1, page - 1, page, page + 1, pages])]
      .filter((n) => n >= 1 && n <= pages)
      .sort((a, b) => a - b);
    let last = 0;
    for (const n of selected) {
      if (last && n - last > 1) {
        const dots = el("span", "…");
        dots.setAttribute("aria-hidden", "true");
        numbers.append(dots);
      }
      const button = el("button", String(n));
      button.type = "button";
      button.setAttribute("aria-label", n + "ページへ");
      if (n === page) button.setAttribute("aria-current", "page");
      button.disabled = working || n === page;
      button.onclick = () => action(() => load(n));
      numbers.append(button);
      last = n;
    }
    $("feedback-pagination").hidden = total === 0;
  }
  async function action(task) {
    if (working) return;
    working = true;
    root.querySelectorAll("button,select").forEach((n) => (n.disabled = true));
    $("feedback-list").setAttribute("aria-busy", "true");
    try {
      await task();
      $("feedback-message").textContent = "";
    } catch (error) {
      $("feedback-message").textContent = error.message;
      $("feedback-status").value = status;
      $("feedback-limit").value = String(limit);
    } finally {
      working = false;
      root
        .querySelectorAll("button,select")
        .forEach((n) => (n.disabled = false));
      $("feedback-list").setAttribute("aria-busy", "false");
      pagination();
    }
  }
  async function load(wanted = page) {
    const nextStatus = $("feedback-status").value,
      nextLimit = Number($("feedback-limit").value) || 10;
    let nextPage = Math.max(1, wanted);
    const get = () =>
      api(
        "?" +
          new URLSearchParams({
            status: nextStatus,
            limit: String(nextLimit),
            offset: String((nextPage - 1) * nextLimit),
          }),
      );
    let result = await get();
    const lastPage = Math.max(
      1,
      Math.ceil((Number(result.total) || 0) / nextLimit),
    );
    if (nextPage > lastPage) {
      nextPage = lastPage;
      result = await get();
    }
    page = nextPage;
    status = nextStatus;
    limit = nextLimit;
    total = Number(result.total) || 0;
    const unread = Number(result.unread) || 0;
    $("feedback-unread").textContent = String(unread);
    $("feedback-unread").hidden = unread === 0;
    $("feedback-unread").setAttribute(
      "aria-label",
      "未確認の投稿 " + unread + "件",
    );
    const list = $("feedback-list");
    list.replaceChildren();
    for (const item of result.items || []) {
      const card = el("article", "");
      card.className = "feedback-card";
      const header = el("div", "");
      header.className = "feedback-card-heading";
      // Editors receive no name/email from the API; only admins can change or delete posts.
      const contact = canManage && result.contact !== false;
      header.append(
        el("h3", contact ? item.name || "名前の記入なし" : "読者からの投稿"),
        el(
          "span",
          new Date(item.created_at).toLocaleString("ja-JP") +
            " ・ " +
            (item.status === "new" ? "未確認" : "確認済み"),
        ),
      );
      const message = el("p", item.message);
      message.className = "feedback-body";
      card.append(header);
      if (contact) {
        const email = el("p", "メール：" + (item.email || "記入なし"));
        email.className = "feedback-email";
        card.append(email);
      }
      card.append(message);
      if (!canManage) {
        list.append(card);
        continue;
      }
      const controls = el("div", "");
      controls.className = "tools";
      const mark = el(
        "button",
        item.status === "new" ? "確認済みにする" : "未確認に戻す",
      );
      mark.onclick = () =>
        action(async () => {
          await api("/" + item.id, "PATCH", {
            status: item.status === "new" ? "read" : "new",
          });
          await load();
        });
      const remove = el("button", "削除");
      remove.className = "danger";
      remove.onclick = () => {
        if (
          confirm(
            "この投稿と名前・メールアドレスを削除しますか？元に戻せません。",
          )
        )
          action(async () => {
            await api("/" + item.id, "DELETE");
            await load();
          });
      };
      controls.append(mark, remove);
      card.append(controls);
      list.append(card);
    }
    const count = (result.items || []).length;
    $("feedback-page-info").textContent = total
      ? (page - 1) * limit +
        1 +
        "–" +
        Math.min(total, (page - 1) * limit + count) +
        "件 / 全" +
        total +
        "件（" +
        page +
        " / " +
        Math.ceil(total / limit) +
        "ページ）"
      : "全0件";
    if (!count) list.append(el("p", "該当する投稿はありません。"));
  }
  $("feedback-refresh").onclick = () => action(() => load());
  $("feedback-status").onchange = () => action(() => load(1));
  $("feedback-limit").onchange = () => action(() => load(1));
  $("feedback-prev").onclick = () => action(() => load(page - 1));
  $("feedback-next").onclick = () => action(() => load(page + 1));
  fetch("/api/admin/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (["admin", "editor"].includes(me?.role)) {
        canManage = me.role === "admin";
        root.hidden = false;
        action(() => load());
      }
    })
    .catch(() => {});
})();
