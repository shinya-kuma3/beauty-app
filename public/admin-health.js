(() => {
  const $ = (id) => document.getElementById(id),
    root = $("health-tools");
  if (!root) return;
  let authorized = false,
    working = false,
    loaded = false;
  const node = (tag, text = "", cls = "") => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const n = (value) =>
    value === null || value === undefined
      ? "未取得"
      : new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(
          value,
        );
  const date = (value) =>
    value
      ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "未取得";
  const bytes = (value) =>
    value === null || value === undefined
      ? "未取得"
      : value >= 1e9
        ? n(value / 1e9) + " GB"
        : value >= 1e6
          ? n(value / 1e6) + " MB"
          : n(value / 1e3) + " KB";
  const messages = {
    monitor_not_configured: "初回設定が必要です。下の手順を確認してください。",
    monitor_sync_wait: "取得は1分に1回までです。少し待ってからお試しください。",
    monitor_permission_denied:
      "APIトークンの権限・対象アカウントを確認してください。",
    monitor_provider_rate_limited:
      "CloudflareのAPI利用制限に達しました。時間をおいて再取得してください。",
    monitor_query_failed:
      "Analyticsを取得できません。トークンのAnalytics権限と提供状況を確認してください。",
    monitor_account_unavailable: "対象アカウントのデータにアクセスできません。",
    monitor_response_invalid: "Cloudflareの応答を読み取れませんでした。",
    monitor_provider_unavailable: "Cloudflareへ接続できませんでした。",
  };
  function metric(card, label, value) {
    const row = node("p", "", "billing-metric");
    row.append(node("span", label), node("strong", value));
    card.append(row);
  }
  function table(headers, rows) {
    const wrap = node("div", "", "billing-table-wrap"),
      el = node("table", "", "billing-table"),
      head = node("thead"),
      tr = node("tr");
    headers.forEach((title) => {
      const th = node("th", title);
      th.scope = "col";
      tr.append(th);
    });
    head.append(tr);
    const body = node("tbody");
    for (const values of rows) {
      const row = node("tr");
      values.forEach((value) => row.append(node("td", String(value))));
      body.append(row);
    }
    if (!rows.length) {
      const row = node("tr"),
        cell = node("td", "対象のデータはまだありません。");
      cell.colSpan = headers.length;
      row.append(cell);
      body.append(row);
    }
    el.append(head, body);
    wrap.append(el);
    return wrap;
  }
  function quotaCard(title, value, unit, reference) {
    const el = node("section", "", "billing-card health-quota " + value.state);
    el.append(node("h3", title));
    const format = unit === "bytes" ? bytes : n;
    metric(el, "利用量", format(value.used) + (unit === "bytes" ? "" : unit));
    metric(
      el,
      reference ? "無料枠との比較（参考）" : "無料枠まで残り",
      value.remaining === null
        ? "未取得"
        : format(value.remaining) + (unit === "bytes" ? "" : unit),
    );
    metric(
      el,
      "無料枠の上限",
      format(value.limit) + (unit === "bytes" ? "" : unit),
    );
    if (value.percent !== null) {
      const bar = node("progress");
      bar.max = 100;
      bar.value = Math.min(100, value.percent);
      bar.setAttribute("aria-label", title + "の使用率");
      el.append(
        bar,
        node(
          "p",
          n(value.percent) +
            "% 使用" +
            (value.state === "warning"
              ? "・上限に近づいています"
              : value.state === "exceeded"
                ? "・上限以上です"
                : ""),
          "health-quota-state",
        ),
      );
    } else el.append(node("p", "未取得のため残量は計算していません。", "hint"));
    return el;
  }
  function render(data) {
    const s = data.segments,
      reference = data.plan !== "free";
    $("health-plan").textContent =
      "契約：" +
      ({
        free: "Workers Free（設定値）",
        paid: "Workers Paid（設定値）",
        unknown: "未確認",
      }[data.plan] || "未確認") +
      (reference
        ? "。以下はFreeの枠との参考比較で、現在の契約の残量ではありません。"
        : "。枠は他のプロジェクトと共有されます。");
    $("health-period").textContent =
      "今日 " +
      date(data.start) +
      " ～ " +
      date(data.end) +
      " ／ 次のリセット " +
      date(data.reset_at);
    $("health-refresh").disabled = !data.configured;
    $("health-setup").hidden = data.configured;
    $("health-quotas").replaceChildren(
      quotaCard("Workerの実行", data.quotas.workers, "回", reference),
      quotaCard("D1の読み込み", data.quotas.reads, "行", reference),
      quotaCard("D1の書き込み", data.quotas.writes, "行", reference),
      quotaCard("D1の保存容量", data.quotas.storage, "bytes", reference),
    );
    const problems = [];
    for (const [key, label] of [
      ["workers", "Worker"],
      ["d1", "D1の処理"],
      ["storage", "D1の容量"],
    ]) {
      const part = s[key];
      if (part.error_code)
        problems.push(
          label +
            "：" +
            (messages[part.error_code] || "取得できませんでした。") +
            (part.data ? " 前回取得した値を表示しています。" : ""),
        );
      if (part.stale && !part.error_code)
        problems.push(
          label + "：表示値が古くなっています。再取得してください。",
        );
    }
    if (s.storage.data && !s.storage.data.complete)
      problems.push(
        "D1の容量は一部しか取得できていないため、アカウント全体の残量は未取得です。",
      );
    $("health-errors").replaceChildren(
      ...problems.map((message) => node("p", message, "health-notice warning")),
    );
    const states = Object.values(data.quotas).map((q) => q.state);
    const stale = Object.values(s).some((v) => v.stale);
    const badge = $("health-badge");
    badge.className = "health-chip";
    badge.textContent = !data.configured
      ? "設定待ち"
      : problems.length || stale
        ? "取得状況を確認"
        : states.includes("exceeded")
          ? "上限以上"
          : states.includes("warning")
            ? "上限に注意"
            : states.includes("unknown")
              ? "一部未取得"
              : "取得済み";
    if (problems.length || states.includes("exceeded"))
      badge.classList.add("warning");
    else if (states.includes("warning")) badge.classList.add("caution");
    $("health-workers-link").href = data.links.workers;
    $("health-d1-link").href = data.links.d1;
    $("health-local-errors").textContent =
      "管理WorkerのHTTP 5xx：今日 " +
      n(data.local_http_errors) +
      "件。この機能の追加後から、現在のDB環境だけを記録しています。DB自体が利用できないときの失敗は記録できません。";
    const workers = s.workers.data;
    $("health-workers-note").textContent =
      "取得日時：" +
      date(s.workers.fetched_at) +
      (workers
        ? " ／ 実行エラー " +
          n(workers.errors) +
          "件 ／ エラー率 " +
          (workers.requests
            ? n((workers.errors / workers.requests) * 100)
            : "0") +
          "%" +
          (!workers.detail_complete ? " ／ 内訳は一部のみ" : "")
        : "");
    $("health-workers").replaceChildren(
      workers
        ? table(
            ["Worker名 / 実行状態", "実行回数", "実行エラー"],
            workers.workers.map((row) => [
              row.name + " / " + row.status,
              n(row.requests),
              n(row.errors),
            ]),
          )
        : node("p", "Workerのデータは未取得です。", "hint"),
    );
    const dbData = s.d1.data,
      storage = s.storage.data,
      byId = new Map((dbData?.databases || []).map((row) => [row.id, row]));
    const dbMap = new Map(
      (storage?.databases || []).map((row) => [row.id, row]),
    );
    for (const row of dbData?.databases || [])
      if (!dbMap.has(row.id))
        dbMap.set(row.id, { id: row.id, name: row.id, bytes: null });
    $("health-d1-note").textContent =
      "処理の取得日時：" +
      date(s.d1.fetched_at) +
      " ／ 容量の取得日時：" +
      date(s.storage.fetched_at) +
      (dbData && !dbData.detail_complete ? " ／ 処理の内訳は一部のみ" : "");
    $("health-databases").replaceChildren(
      table(
        [
          "DB名",
          "読み込み / 書き込み行数",
          "読み / 書きクエリ数",
          "処理時間 P90",
          "容量 / 1DB上限（Free）",
        ],
        [...dbMap.values()].map((row) => {
          const usage = byId.get(row.id);
          const noUsage = dbData?.detail_complete;
          const value = (key) =>
            usage ? n(usage[key]) : noUsage ? "0" : "未取得";
          return [
            (row.name || row.id) +
              (row.id === data.database_id ? "（管理画面のDB）" : ""),
            value("rowsRead") + " / " + value("rowsWritten"),
            value("readQueries") + " / " + value("writeQueries"),
            usage?.p90_ms === null || usage?.p90_ms === undefined
              ? "未取得"
              : n(usage.p90_ms) + " ms",
            bytes(row.bytes) +
              " / 500 MB" +
              (row.bytes >= 500000000
                ? "・Free上限以上"
                : row.bytes >= 400000000
                  ? "・上限に注意"
                  : ""),
          ];
        }),
      ),
    );
    const hourly = new Map();
    for (const row of workers?.hourly || []) hourly.set(row.hour, { ...row });
    for (const row of dbData?.hourly || [])
      hourly.set(row.hour, { ...(hourly.get(row.hour) || {}), ...row });
    $("health-hourly").replaceChildren(
      table(
        [
          "時間帯（日本時間）",
          "Worker実行",
          "実行エラー",
          "D1読み込み行",
          "D1書き込み行",
        ],
        [...hourly.values()]
          .sort((a, b) => a.hour.localeCompare(b.hour))
          .map((row) => [
            date(row.hour),
            n(row.requests),
            n(row.errors),
            n(row.rowsRead),
            n(row.rowsWritten),
          ]),
      ),
    );
    $("health-message").textContent = data.configured
      ? problems.length
        ? "一部の情報を取得できませんでした。下の取得状況を確認してください。"
        : "取得時点の利用状況を表示しています。自動取得は5分間隔です。"
      : "初回設定後に数値を取得できます。";
  }
  async function load(sync = false) {
    if (!authorized || working) return;
    working = true;
    root.setAttribute("aria-busy", "true");
    $("health-refresh").disabled = true;
    try {
      const response = await fetch(
        "/api/admin/health" + (sync ? "/sync" : ""),
        sync ? { method: "POST" } : {},
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          messages[data.error?.code] ||
            "取得できませんでした。ログイン状態と設定を確認してください。",
        );
      render(data);
      loaded = true;
    } catch (error) {
      $("health-message").textContent = error.message;
    } finally {
      working = false;
      root.removeAttribute("aria-busy");
      if ($("health-setup").hidden) $("health-refresh").disabled = false;
    }
  }
  $("health-refresh").addEventListener("click", () => load(true));
  root.addEventListener("toggle", () => {
    if (root.open) load();
  });
  setInterval(() => {
    if (authorized && loaded && root.open && !document.hidden) load();
  }, 300000);
  fetch("/api/admin/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (me?.role === "admin") {
        authorized = true;
        root.hidden = false;
        // The dashboard opens this panel before the role is known.
        if (root.open) load();
      }
    })
    .catch(() => {});
})();
