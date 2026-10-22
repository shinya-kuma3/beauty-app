// Dashboard: daily traffic of the public site and (trial) views per article.
(() => {
  const root = document.getElementById("analytics-chart");
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";
  const series = [
    { key: "page_views", label: "閲覧数", color: "#2a78d6" },
    { key: "visitors", label: "訪問者数", color: "#eb6834" },
  ];
  const errors = {
    analytics_permission_denied:
      "Cloudflareのトークンに「Zone → Analytics → Read」の権限がないか、ゾーンIDが違う可能性があります。",
    analytics_provider_rate_limited:
      "Cloudflareの取得回数の制限に達しました。少し待ってから再度お試しください。",
    analytics_provider_unavailable:
      "Cloudflareから取得できませんでした。時間をおいて再度お試しください。",
    analytics_response_invalid:
      "Cloudflareの応答を読み取れませんでした。時間をおいて再度お試しください。",
    analytics_zone_unavailable:
      "対象のゾーンが見つかりません。ゾーンIDと、トークンの対象ゾーンを確認してください。",
    analytics_query_failed: "Cloudflareがこの集計の取得を受け付けませんでした。",
    analytics_sync_wait: "1分ほど待ってから、もう一度お試しください。",
  };
  let role = null,
    days = 30,
    current = null,
    working = false;
  const n = (value) =>
    value === null || value === undefined ? "—" : Number(value).toLocaleString("ja-JP");
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const shortDate = (date) => {
    const [, m, d] = date.split("-");
    return Number(m) + "/" + Number(d);
  };
  const jst = (value) =>
    value
      ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "—";
  async function api(path) {
    const response = await fetch("/api/admin/" + path, { credentials: "same-origin" });
    let data = null;
    try {
      data = await response.json();
    } catch {}
    if (!response.ok)
      throw new Error(
        errors[data?.error?.code] || "アクセス数を取得できませんでした。ログイン状態を確認してください。",
      );
    return data;
  }
  function errorText(result) {
    if (!result.error_code) return "";
    return (
      (errors[result.error_code] || errors.analytics_provider_unavailable) +
      (result.provider_message ? "（Cloudflareの説明：" + result.provider_message + "）" : "")
    );
  }
  function niceMax(value) {
    if (!value) return 4;
    const step = 10 ** Math.floor(Math.log10(value));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
    return 10 * step;
  }
  function tiles(rows) {
    const sum = (key) => {
      const values = rows.map((r) => r[key]).filter((v) => v !== null);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
    const items = [
      ["閲覧数", sum("page_views"), "ページが表示された回数の目安"],
      ["訪問者数（延べ）", sum("visitors"), "日ごとのユニーク訪問者を合計"],
      ["リクエスト数", sum("requests"), "画像なども含むすべての取得"],
    ];
    $("analytics-tiles").replaceChildren(
      ...items.map(([label, value, note]) => {
        const tile = el("div", undefined, "stat-tile");
        tile.append(el("span", label, "stat-label"), el("strong", n(value), "stat-value"), el("span", note, "stat-note"));
        return tile;
      }),
    );
  }
  function legend() {
    $("analytics-legend").replaceChildren(
      ...series.map((s) => {
        const item = el("span", undefined, "legend-item");
        const swatch = el("span", undefined, "legend-swatch");
        swatch.style.background = s.color;
        item.append(swatch, el("span", s.label));
        return item;
      }),
    );
  }
  function table(rows) {
    const t = el("table", undefined, "analytics-data");
    const head = el("tr");
    for (const label of ["日付（UTC）", "閲覧数", "訪問者数", "リクエスト数"]) head.append(el("th", label));
    t.append(head);
    for (const row of rows) {
      const tr = el("tr");
      tr.append(el("td", row.date), el("td", n(row.page_views)), el("td", n(row.visitors)), el("td", n(row.requests)));
      t.append(tr);
    }
    $("analytics-table").replaceChildren(t);
  }
  function chart(rows) {
    root.replaceChildren();
    if (!rows.some((r) => series.some((s) => r[s.key] !== null))) {
      root.append(el("p", "この期間のデータはまだありません。", "hint"));
      return;
    }
    const width = Math.max(320, root.clientWidth || 720),
      height = 260,
      pad = { top: 16, right: 16, bottom: 30, left: 52 };
    const w = width - pad.left - pad.right,
      h = height - pad.top - pad.bottom;
    const max = niceMax(Math.max(...rows.flatMap((r) => series.map((s) => r[s.key] ?? 0))));
    const x = (i) => pad.left + (rows.length === 1 ? w / 2 : (i * w) / (rows.length - 1));
    const y = (v) => pad.top + h - (v / max) * h;
    const graphic = svg("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: "img",
      "aria-label": "日別の閲覧数と訪問者数の推移",
    });
    for (let i = 0; i <= 4; i++) {
      const value = (max / 4) * i;
      graphic.append(
        svg("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), stroke: "#e4edf3", "stroke-width": 1 }),
      );
      const label = svg("text", { x: pad.left - 8, y: y(value) + 4, "text-anchor": "end", class: "chart-tick" });
      label.textContent = Number(value).toLocaleString("ja-JP");
      graphic.append(label);
    }
    const ticks = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
    for (const i of ticks) {
      const label = svg("text", { x: x(i), y: height - 8, "text-anchor": i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle", class: "chart-tick" });
      label.textContent = shortDate(rows[i].date);
      graphic.append(label);
    }
    for (const s of series) {
      // Break the line where Cloudflare returned no data rather than drawing it as zero.
      let d = "",
        pen = false;
      rows.forEach((r, i) => {
        if (r[s.key] === null) {
          pen = false;
          return;
        }
        d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(r[s.key]).toFixed(1) + " ";
        pen = true;
      });
      graphic.append(svg("path", { d: d.trim(), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      if (rows.length <= 31)
        rows.forEach((r, i) => {
          if (r[s.key] !== null)
            graphic.append(svg("circle", { cx: x(i), cy: y(r[s.key]), r: rows.length <= 7 ? 4 : 2.5, fill: s.color, stroke: "#fff", "stroke-width": 2 }));
        });
    }
    const cross = svg("line", { y1: pad.top, y2: pad.top + h, stroke: "#9fb4c4", "stroke-width": 1, visibility: "hidden" });
    graphic.append(cross);
    const hit = svg("rect", { x: pad.left, y: pad.top, width: w, height: h, fill: "transparent" });
    graphic.append(hit);
    const tip = el("div", undefined, "chart-tooltip");
    tip.hidden = true;
    let active = -1;
    const point = (i) => {
      active = Math.max(0, Math.min(rows.length - 1, i));
      const r = rows[active];
      cross.setAttribute("x1", x(active));
      cross.setAttribute("x2", x(active));
      cross.setAttribute("visibility", "visible");
      tip.replaceChildren(el("strong", r.date + "（UTC）"));
      for (const s of series) {
        const line = el("span", undefined, "tip-row");
        const swatch = el("span", undefined, "legend-swatch");
        swatch.style.background = s.color;
        line.append(swatch, el("span", s.label + "：" + n(r[s.key])));
        tip.append(line);
      }
      tip.append(el("span", "リクエスト数：" + n(r.requests), "tip-row"));
      tip.hidden = false;
      const left = (x(active) / width) * 100;
      tip.style.left = left + "%";
      tip.classList.toggle("tip-left", left > 60);
    };
    const leave = () => {
      cross.setAttribute("visibility", "hidden");
      tip.hidden = true;
      active = -1;
    };
    hit.addEventListener("mousemove", (event) => {
      const box = graphic.getBoundingClientRect?.();
      if (!box?.width) return;
      const px = ((event.clientX - box.left) / box.width) * width;
      point(Math.round(((px - pad.left) / w) * (rows.length - 1)));
    });
    hit.addEventListener("mouseleave", leave);
    root.tabIndex = 0;
    root.setAttribute("aria-label", "グラフ。左右の矢印キーで日ごとの数値を表示します。");
    root.onkeydown = (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        point(active < 0 ? rows.length - 1 : active + (event.key === "ArrowRight" ? 1 : -1));
      } else if (event.key === "Escape") leave();
    };
    root.onblur = leave;
    root.append(graphic, tip);
  }
  function render(result) {
    current = result;
    $("analytics-setup").hidden = result.configured || role !== "admin";
    if (!result.configured) {
      $("analytics-message").textContent =
        role === "admin" ? "" : "アクセス数の表示は準備中です。管理者の設定が終わると表示されます。";
      $("analytics-tiles").replaceChildren();
      root.replaceChildren();
      $("analytics-table").replaceChildren();
      $("analytics-updated").textContent = "";
      return;
    }
    $("analytics-message").textContent = errorText(result) + (result.stale && result.data ? " 前回取得した数値を表示しています。" : "");
    const rows = result.data?.series ?? [];
    tiles(rows);
    legend();
    chart(rows);
    table(rows);
    $("analytics-updated").textContent = result.fetched_at
      ? "取得日時：" + jst(result.fetched_at) + "（15分ごとに更新）"
      : "";
  }
  async function load(nextDays = days) {
    if (working) return;
    working = true;
    root.setAttribute("aria-busy", "true");
    try {
      const result = await api("analytics?days=" + nextDays);
      days = nextDays;
      document.querySelectorAll("[data-analytics-days]").forEach((b) =>
        b.setAttribute("aria-pressed", String(Number(b.dataset.analyticsDays) === days)),
      );
      render(result);
    } catch (error) {
      $("analytics-message").textContent = error.message;
    } finally {
      working = false;
      root.removeAttribute("aria-busy");
    }
  }
  document.querySelectorAll("[data-analytics-days]").forEach((button) => {
    button.addEventListener("click", () => load(Number(button.dataset.analyticsDays)));
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => current?.data && chart(current.data.series), 200);
  });
  window.addEventListener("admin-page", (event) => {
    if (event.detail?.page === "dashboard" && current?.data) chart(current.data.series);
  });
  $("pages-load").addEventListener("click", async () => {
    const button = $("pages-load"),
      period = Number($("pages-days").value);
    button.disabled = true;
    $("pages-message").textContent = "取得しています…";
    $("pages-result").replaceChildren();
    try {
      const result = await api("analytics/pages?refresh=1&days=" + period);
      if (!result.configured) {
        $("pages-message").textContent = "アクセス数の設定が終わると取得できます。";
        return;
      }
      const pages = result.data?.pages ?? [];
      $("pages-message").textContent = result.error_code
        ? period + "日分は取得できませんでした。" + errorText(result) + (result.data ? " 前回取得した結果を表示しています。" : "")
        : period + "日分を取得できました（" + jst(result.data?.start) + " 〜 " + jst(result.data?.end) + "）。";
      if (!result.data) return;
      if (!pages.length) {
        $("pages-result").append(el("p", "この期間に記事ページの閲覧はありませんでした。", "hint"));
        return;
      }
      const t = el("table", undefined, "analytics-data");
      const head = el("tr");
      for (const label of ["順位", "記事", "閲覧数"]) head.append(el("th", label));
      t.append(head);
      pages.forEach((page, i) => {
        const tr = el("tr"),
          cell = el("td"),
          link = el("a", page.title || page.path);
        link.href = "https://my-beauty-palette.com" + page.path;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        cell.append(link);
        tr.append(el("td", String(i + 1)), cell, el("td", n(page.views)));
        t.append(tr);
      });
      $("pages-result").append(t);
    } catch (error) {
      $("pages-message").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  fetch("/api/admin/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me) return;
      role = me.role;
      load();
    })
    .catch(() => {});
})();
