// Menu and page switching for the admin screens. Every page lives in the same document,
// so editing state (e.g. an unsaved article) survives moving between pages.
(() => {
  const pages = [...document.querySelectorAll(".admin-page")];
  if (!pages.length) return;
  const ownerPages = ["ai", "usage", "team"];
  const titles = {
    dashboard: "ダッシュボード",
    articles: "記事",
    publications: "公開記事の管理",
    feedback: "意見箱",
    ai: "収集・AI処理",
    usage: "使用量・料金",
    team: "編集者の管理",
  };
  let role = null;
  const pageFromPath = (path) => {
    const match = /^\/admin(?:\/([a-z]+))?(?:\/.*)?$/.exec(path);
    const name = match?.[1] || "dashboard";
    return titles[name] ? name : "dashboard";
  };
  function openPanels(section) {
    // Panels that load on first open (health, billing, ...) start loading when their page is shown.
    section
      .querySelectorAll("details[data-page-panel]")
      .forEach((panel) => {
        if (!panel.open) panel.open = true;
      });
  }
  function show(name, { focus = false } = {}) {
    if (role === "editor" && ownerPages.includes(name)) name = "dashboard";
    for (const section of pages) section.hidden = section.dataset.page !== name;
    document.querySelectorAll("[data-nav]").forEach((link) => {
      if (link.dataset.nav === name) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.body.dataset.adminPage = name;
    document.title = titles[name] + " | my beauty palette 管理画面";
    const section = pages.find((s) => s.dataset.page === name);
    if (section) {
      openPanels(section);
      if (focus) section.querySelector("h1")?.focus({ preventScroll: true });
    }
    window.dispatchEvent(new CustomEvent("admin-page", { detail: { page: name } }));
    return name;
  }
  function go(path, { replace = false } = {}) {
    if (role === "editor" && ownerPages.includes(pageFromPath(path))) path = "/admin";
    const name = pageFromPath(path);
    if (location.pathname !== path)
      history[replace ? "replaceState" : "pushState"](null, "", path);
    show(name, { focus: !replace });
    window.scrollTo?.(0, 0);
  }
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
      event.preventDefault();
      go(link.getAttribute("href"));
    });
  });
  pages.forEach((section) => section.querySelector("h1")?.setAttribute("tabindex", "-1"));
  window.addEventListener("popstate", () => show(pageFromPath(location.pathname)));
  window.BeautyAdminNav = { go, show, current: () => document.body.dataset.adminPage };
  show(document.body.dataset.adminPage || pageFromPath(location.pathname));
  fetch("/api/admin/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me) return;
      role = me.role;
      document
        .querySelectorAll("[data-owner-only]")
        .forEach((item) => (item.hidden = role !== "admin"));
      if (role !== "admin" && ownerPages.includes(document.body.dataset.adminPage))
        go("/admin", { replace: true });
    })
    .catch(() => {});
})();
