(() => {
  const $ = (id) => document.getElementById(id),
    root = $("billing-tools");
  if (!root) return;
  let working = false,
    connected = false;
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const n = (value) =>
    value === null || value === undefined
      ? "未取得"
      : Number(value).toLocaleString("ja-JP");
  const money = (value, currency = "USD") =>
    value === null || value === undefined
      ? "未取得"
      : new Intl.NumberFormat("ja-JP", {
          style: "currency",
          currency,
          maximumFractionDigits: 6,
        }).format(value);
  const date = (value) =>
    value
      ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "未取得";
  function link(url, title) {
    const a = node("a", title);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function card(title, subtitle) {
    const el = node("section", "", "billing-card");
    el.append(node("h3", title), node("p", subtitle, "hint"));
    return el;
  }
  function metric(el, title, value) {
    const p = node("p", "", "billing-metric");
    p.append(node("span", title), node("strong", value));
    el.append(p);
  }
  async function api(path = "", body) {
    const response = await fetch(
      "/api/admin/billing" + path,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {},
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        messages[data.error?.code] ||
          "取得できませんでした。ログイン状態と設定を確認してください。",
      );
    return data;
  }
  const messages = {
    cursor_csv_columns_required:
      "Date・Type・Costの列が必要です。CursorのUsage画面から書き出したCSVを選んでください。",
    cursor_csv_date_requires_timezone:
      "Dateにタイムゾーンがありません。タイムゾーン付きの公式CSVを選んでください。",
    invalid_cursor_csv_date: "CSVの日付が読み取れません。",
    invalid_cursor_csv_number: "CSVの金額またはトークン数が読み取れません。",
    invalid_cursor_csv:
      "CSVの形式が読み取れません。公式画面から再度書き出してください。",
    cursor_csv_too_large: "1.5MB以内のCSVを選んでください。",
    cursor_csv_too_many_rows:
      "期間を短くして10,000行以内のCSVを選んでください。",
    cloudflare_billing_not_configured:
      "Cloudflare請求履歴の読み取り設定が必要です。",
    billing_sync_wait: "請求履歴の再取得は1分以上間隔を空けてください。",
  };
  async function action(task) {
    if (working) return;
    working = true;
    root.querySelectorAll("button,input").forEach((el) => (el.disabled = true));
    root.setAttribute("aria-busy", "true");
    $("billing-message").textContent = "処理中…";
    try {
      await task();
    } catch (error) {
      $("billing-message").textContent = error.message;
    } finally {
      working = false;
      root.removeAttribute("aria-busy");
      root
        .querySelectorAll("button,input")
        .forEach((el) => (el.disabled = false));
      $("billing-sync").disabled = !connected;
    }
  }
  function render(data) {
    $("billing-pricing-date").textContent = data.pricing_date;
    const daily = data.local.daily,
      summary = card(
        "今日のアプリ内上限",
        "日本時間09:00にリセット。各社の無料枠とは別の、呼び出しを抑えるための上限です。",
      );
    metric(
      summary,
      "AI呼び出し",
      n(daily.calls) + " / " + n(daily.call_limit) + "回",
    );
    metric(
      summary,
      "予約量",
      n(daily.reserved_tokens) + " / " + n(daily.token_limit),
    );
    summary.append(
      node(
        "p",
        "予約量は入力サイズ等から見積もった予算で、実測トークン・料金ではありません。",
        "hint",
      ),
    );
    const progress = document.createElement("progress");
    progress.max = Math.max(1, daily.call_limit);
    progress.value = Math.min(daily.calls, daily.call_limit);
    progress.setAttribute("aria-label", "アプリ内の1日AI呼び出し上限の使用率");
    summary.append(progress);
    $("billing-summary").replaceChildren(summary);
    const cursor = card("Cursor Pro / Grok Bot", data.cursor.note);
    metric(cursor, "現在の残量", "公式Spendingで確認");
    metric(cursor, "CSV取り込み日時", date(data.cursor.fetched_at));
    if (data.cursor.first_event_at)
      cursor.append(
        node(
          "p",
          "CSVの最初の利用：" +
            date(data.cursor.first_event_at) +
            " ／ 最後の利用：" +
            date(data.cursor.last_event_at),
          "hint",
        ),
      );
    for (const [type, title] of [
      ["included", "契約に含まれる利用"],
      ["on_demand", "追加利用"],
      ["other", "種別未分類"],
    ]) {
      const groups = data.cursor.groups.filter((g) => g.type === type);
      if (!groups.length) continue;
      const cost = groups.reduce((a, b) => a + b.cost_usd, 0),
        missing = groups.reduce((a, b) => a + b.unknown_cost_rows, 0);
      metric(
        cursor,
        title + "（CSVの金額）",
        money(cost) + (missing ? " + 金額未取得 " + n(missing) + "件" : ""),
      );
      metric(
        cursor,
        title + "の取得済みトークン",
        n(groups.reduce((a, b) => a + b.total_tokens, 0)),
      );
      const unknown = groups.reduce((a, b) => a + b.unknown_token_rows, 0);
      if (unknown)
        cursor.append(
          node("p", "トークン未取得：" + n(unknown) + "件", "hint"),
        );
    }
    if (!data.cursor.groups.length)
      cursor.append(
        node(
          "p",
          data.cursor.status === "not_imported"
            ? "CSV未取り込み"
            : "選んだ年月の履歴はCSVにありません。",
        ),
      );
    cursor.append(
      node(
        "p",
        "個人Proは追加利用を有効にした場合、契約枠を使い切った後に追加課金。リセットは契約の請求期間ごとです。",
        "hint",
      ),
      link(data.cursor.link, "Cursorの残量・追加課金設定を確認"),
    );
    const gemini = card("Gemini API", data.gemini.note);
    metric(
      gemini,
      "APIの契約状態",
      { unknown: "未確認", free: "無料枠（設定値）", paid: "有料（設定値）" }[
        data.gemini.tier
      ],
    );
    metric(gemini, "残高・実請求額", "AI Studioで確認");
    gemini.append(
      node(
        "p",
        "無料枠の制限に達すると処理を延期します。アプリが自動で有料契約へ変更することはありません。有料プロジェクトでは契約に従って課金されます。",
        "hint",
      ),
      link(data.gemini.link, "AI Studioの利用量・課金を確認"),
    );
    const cf = card("Cloudflareの請求履歴", data.cloudflare.note);
    connected = data.cloudflare.can_sync;
    metric(
      cf,
      "連携状態",
      {
        error: data.cloudflare.fetched_at ? "取得失敗（前回の結果を保持）" : "取得失敗（未取得）",
        connected: "取得済み",
        not_configured: "読み取り設定が必要",
      }[data.cloudflare.status],
    );
    metric(cf, "取得日時", date(data.cloudflare.fetched_at));
    if (data.cloudflare.error_code)
      cf.append(
        node(
          "p",
          data.cloudflare.error_code === "billing_permission_denied"
            ? "Billing Read権限を確認してください。"
            : "提供元から取得できませんでした。時間を空けて再取得してください。",
          "billing-warning",
        ),
      );
    if (data.cloudflare.entries.length) {
      const table = node("table", "", "billing-table"),
        header = node("tr", "");
      ["日付", "金額", "種別", "状態"].forEach((text) =>
        header.append(node("th", text)),
      );
      table.append(header);
      for (const entry of data.cloudflare.entries) {
        const tr = node("tr", "");
        [
          date(entry.date),
          money(entry.amount, entry.currency),
          entry.type,
          entry.status,
        ].forEach((text) => tr.append(node("td", text)));
        table.append(tr);
      }
      const wrap = node("div", "", "billing-table-wrap");
      wrap.append(table);
      cf.append(wrap);
    } else
      cf.append(
        node(
          "p",
          data.cloudflare.fetched_at
            ? "取得した履歴に、この年月の項目はありません。請求額が0円という意味ではありません。"
            : "請求履歴は未取得です。",
        ),
      );
    if (data.cloudflare.fetched_at && !data.cloudflare.complete)
      cf.append(
        node(
          "p",
          "履歴の件数上限により、一部だけを表示しています。",
          "billing-warning",
        ),
      );
    cf.append(
      link("https://dash.cloudflare.com/", "Cloudflareの請求・利用量を確認"),
    );
    $("billing-providers").replaceChildren(cursor, gemini, cf);
    const models = card("モデル別の利用量（UTCの年月）", data.local.scope);
    for (const row of data.local.models) {
      const group = node("section", "", "billing-model");
      group.append(node("h4", row.model));
      metric(group, "呼び出し", n(row.calls) + "回");
      metric(
        group,
        "取得済み入力 / 出力トークン",
        n(row.input_tokens) + " / " + n(row.output_tokens),
      );
      metric(
        group,
        "トークン未取得・推定の呼び出し",
        n(row.unknown_calls) + "回",
      );
      if (row.estimate) {
        metric(
          group,
          "取得済み分の有料単価換算",
          money(row.estimate.minimum) + " 〜 " + money(row.estimate.maximum),
        );
        group.append(node("p", row.estimate.note, "hint"));
      } else group.append(node("p", "金額換算は未取得です。", "hint"));
      models.append(group);
    }
    if (!data.local.models.length)
      models.append(node("p", "この年月の利用記録はありません。"));
    for (const call of data.local.calls)
      metric(
        models,
        call.service +
          " / " +
          call.operation +
          (call.service === "youtube" ? "（太平洋時間の年月）" : ""),
        n(call.calls) + "回",
      );
    $("billing-models").replaceChildren(models);
    $("billing-services").replaceChildren(
      ...data.services.map((service) => {
        const el = card(service.name, service.condition);
        metric(el, "無料割当・利用枠", service.allowance);
        metric(el, "リセット", service.reset);
        metric(el, "アカウント全体の残量", "未取得");
        el.append(link(service.link, "公式の利用量・料金を確認"));
        return el;
      }),
    );
  }
  async function load() {
    render(
      await api("?" + new URLSearchParams({ month: $("billing-month").value })),
    );
    $("billing-message").textContent = "表示を更新しました。";
  }
  $("billing-month").value = new Date().toISOString().slice(0, 7);
  $("billing-filter").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.reportValidity()) action(load);
  });
  $("billing-sync").addEventListener("click", () =>
    action(async () => {
      const result = await api("/sync", {});
      await load();
      if (!result.ok)
        $("billing-message").textContent =
          "請求履歴を取得できませんでした。前回取得した結果を保持しています。";
    }),
  );
  $("cursor-import").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const file = $("cursor-csv").files[0];
    if (!file) return;
    action(async () => {
      if (file.size > 1500000) throw new Error(messages.cursor_csv_too_large);
      const result = await api("/cursor", {
        csv: await file.text(),
        replace_confirmed: $("cursor-replace").checked,
      });
      await load();
      event.target.reset();
      $("billing-message").textContent = result.unchanged
        ? "同じCSVのため、重複加算せず既存の集計を表示しました。"
        : n(result.rows) + "件の利用履歴を取り込みました。";
    });
  });
  root.addEventListener("toggle", () => {
    if (root.open) action(load);
  });
  fetch("/api/admin/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (me?.role === "admin") root.hidden = false;
    })
    .catch(() => {});
})();
