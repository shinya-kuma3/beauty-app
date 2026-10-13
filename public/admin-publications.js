(() => {
  const $ = (id) => document.getElementById(id),
    root = $("publication-tools");
  if (!root) return;
  let offset = 0,
    total = 0,
    working = false,
    selected = null,
    q = "",
    status = "all";
  const el = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  async function api(path, method = "GET", body) {
    const r = await fetch("/api/admin/publications" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    if (!r.ok)
      throw new Error(
        data.error?.code === "revision_conflict"
          ? "記事が更新されています。一覧を更新して再度確認してください。"
          : "処理できませんでした。ログイン状態と入力を確認してください。",
      );
    return data;
  }
  function controls() {
    root
      .querySelectorAll("button,input,select")
      .forEach((n) => (n.disabled = working));
    $("publication-prev").disabled = working || offset === 0;
    $("publication-next").disabled = working || offset + 20 >= total;
  }
  async function action(task) {
    if (working) return;
    working = true;
    controls();
    try {
      await task();
      $("publication-message").textContent = "";
    } catch (e) {
      $("publication-message").textContent = e.message;
    } finally {
      working = false;
      controls();
    }
  }
  async function load(next = offset) {
    const result = await api(
      "?" +
        new URLSearchParams({ q, status, limit: "20", offset: String(next) }),
    );
    offset = next;
    total = result.total || 0;
    const list = $("publication-list");
    list.replaceChildren();
    for (const item of result.items || []) {
      const card = el("article", "");
      card.className = "feedback-card";
      const heading = el("div", "");
      heading.className = "feedback-card-heading";
      heading.append(
        el("h3", item.title),
        el("span", item.origin === "initial" ? "初期記事" : "AI記事"),
      );
      card.append(heading, el("p", item.excerpt));
      const withdrawal = item.withdrawal;
      if (withdrawal) {
        card.append(
          el(
            "p",
            withdrawal.state === "withdrawn"
              ? "非公開の反映済み"
              : withdrawal.state === "building"
                ? "非公開の再ビルド待ち"
                : "非公開のGitHub反映待ち",
          ),
          el("p", "理由：" + withdrawal.reason),
          el("p", "操作：" + withdrawal.actor),
        );
      } else {
        const link = el("a", "公開ページを確認");
        link.href =
          "https://my-beauty-palette.com/articles/" +
          encodeURIComponent(item.slug) +
          "/";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const button = el("button", "非公開にする");
        button.className = "danger";
        button.onclick = () => {
          selected = item;
          $("withdraw-article").textContent = item.title;
          $("withdraw-reason").value = "";
          $("withdraw-confirm").checked = false;
          $("withdraw-error").textContent = "";
          $("withdraw-dialog").showModal();
          $("withdraw-reason").focus();
        };
        const tools = el("div", "");
        tools.className = "tools";
        tools.append(link, button);
        card.append(tools);
      }
      list.append(card);
    }
    if (!total) list.append(el("p", "該当する記事はありません。"));
    $("publication-count").textContent = total
      ? "全" +
        total +
        "件 ・ " +
        (Math.floor(offset / 20) + 1) +
        " / " +
        Math.ceil(total / 20) +
        "ページ"
      : "全0件";
  }
  $("publication-filters").onsubmit = (e) => {
    e.preventDefault();
    q = $("publication-query").value.trim();
    status = $("publication-status").value;
    action(() => load(0));
  };
  $("publication-prev").onclick = () =>
    action(() => load(Math.max(0, offset - 20)));
  $("publication-next").onclick = () => action(() => load(offset + 20));
  $("withdraw-cancel").onclick = () => $("withdraw-dialog").close();
  $("withdraw-form").onsubmit = async (e) => {
    e.preventDefault();
    if (working || !selected || !$("withdraw-form").reportValidity()) return;
    working = true;
    controls();
    $("withdraw-form")
      .querySelectorAll("button,input,textarea")
      .forEach((n) => (n.disabled = true));
    try {
      await api("/withdraw", "POST", {
        slug: selected.slug,
        revision_token: selected.revision_token,
        reason: $("withdraw-reason").value.trim(),
        confirmed: $("withdraw-confirm").checked,
      });
      $("withdraw-dialog").close();
      await load(0);
      $("publication-message").textContent =
        "非公開を依頼しました。反映状態は一覧を更新して確認できます。";
    } catch (error) {
      $("withdraw-error").textContent = error.message;
    } finally {
      working = false;
      controls();
      $("withdraw-form")
        .querySelectorAll("button,input,textarea")
        .forEach((n) => (n.disabled = false));
    }
  };
  $("withdraw-dialog").addEventListener("cancel", (e) => {
    if (working) e.preventDefault();
  });
  fetch("/api/admin/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (["admin", "editor"].includes(me?.role)) {
        root.hidden = false;
        action(() => load());
      }
    })
    .catch(() => {});
})();
