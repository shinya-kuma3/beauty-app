(() => {
  const root = document.getElementById("feedback-tools");
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  let offset = 0,
    working = false;
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
  async function action(task) {
    if (working) return;
    working = true;
    root.querySelectorAll("button,select").forEach((n) => (n.disabled = true));
    try {
      await task();
      $("feedback-message").textContent = "";
    } catch (error) {
      $("feedback-message").textContent = error.message;
    } finally {
      working = false;
      root
        .querySelectorAll("button,select")
        .forEach((n) => (n.disabled = false));
    }
  }
  async function load(more = false) {
    if (!more) {
      offset = 0;
      $("feedback-list").replaceChildren();
    }
    const result = await api(
      "?status=" + $("feedback-status").value + "&offset=" + offset,
    );
    const unread = Number(result.unread) || 0;
    $("feedback-unread").textContent = String(unread);
    $("feedback-unread").hidden = unread === 0;
    $("feedback-unread").setAttribute(
      "aria-label",
      "未確認の投稿 " + unread + "件",
    );
    for (const item of result.items || []) {
      const card = el("article", "");
      card.className = "feedback-card";
      const heading = el("h3", item.name || "名前の記入なし");
      card.append(
        heading,
        el(
          "p",
          new Date(item.created_at).toLocaleString("ja-JP") +
            " ・ " +
            (item.status === "new" ? "未確認" : "確認済み"),
        ),
        el("p", "メール：" + (item.email || "記入なし")),
      );
      const message = el("p", item.message);
      message.className = "feedback-body";
      card.append(message);
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
      $("feedback-list").append(card);
    }
    offset += (result.items || []).length;
    $("feedback-more").hidden = offset >= (result.total || 0);
    if (!offset)
      $("feedback-list").append(el("p", "該当する投稿はありません。"));
  }
  $("feedback-refresh").onclick = () => action(() => load());
  $("feedback-status").onchange = () => action(() => load());
  $("feedback-more").onclick = () => action(() => load(true));
  fetch("/api/admin/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (me?.role === "admin") {
        root.hidden = false;
        action(() => load());
      }
    })
    .catch(() => {});
})();
