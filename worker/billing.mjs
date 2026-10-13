import { ApiError, hash, now } from "./core.mjs";
import { settings } from "./config.mjs";

export const pricingDate = "2026-10-13";
export function monthRange(month = now().slice(0, 7)) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))
    throw new ApiError(400, "invalid_billing_month");
  const start = month + "-01",
    end = new Date(start + "T00:00:00Z");
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { month, start, end: end.toISOString().slice(0, 10) };
}
// Recording an attempted request must not prevent feedback/video collection.
export async function recordApiCall(env, service, operation) {
  const day =
    service === "youtube"
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Los_Angeles",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date())
      : now().slice(0, 10);
  try {
    await env.DB.prepare(
      "INSERT INTO api_usage(day,service,operation,calls) VALUES(?,?,?,1) ON CONFLICT(day,service,operation) DO UPDATE SET calls=calls+1",
    )
      .bind(day, service, operation)
      .run();
  } catch {
    console.error(
      JSON.stringify({ event: "api_usage_record_failed", service }),
    );
  }
}
function csvRows(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > 1500000
  )
    throw new ApiError(413, "cursor_csv_too_large");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else if (c === undefined) throw new ApiError(400, "invalid_cursor_csv");
      else cell += c;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === "," || c === "\n" || c === undefined) {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        if (rows.length > 10001)
          throw new ApiError(413, "cursor_csv_too_many_rows");
      }
    } else if (
      c === "\r" &&
      (text[i + 1] === "\n" || text[i + 1] === undefined)
    ) {
      /* CRLF */
    } else if (closed || c === '"')
      throw new ApiError(400, "invalid_cursor_csv");
    else cell += c;
  }
  return rows;
}
const key = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const number = (v, money = false) => {
  if (!v?.trim()) return null;
  const s = money
    ? v.trim().replace(/^\$/, "").replace(/,/g, "")
    : v.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(s))
    throw new ApiError(400, "invalid_cursor_csv_number");
  const n = Number(s);
  if (!Number.isFinite(n) || n > 1e12 || (!money && !Number.isSafeInteger(n)))
    throw new ApiError(400, "invalid_cursor_csv_number");
  return n;
};
export function parseCursorCsv(text) {
  const rows = csvRows(text),
    headers = rows.shift()?.map(key) ?? [];
  if (headers.length !== new Set(headers).size)
    throw new ApiError(400, "invalid_cursor_csv");
  const col = (...names) => headers.findIndex((v) => names.includes(v));
  const date = col("date", "timestamp"),
    kind = col("type", "kind"),
    cost = col("cost", "costusd"),
    model = col("model");
  const total = col("totaltokens"),
    output = col("outputtokens");
  const input = col("inputtokens"),
    noCache = col("inputtokenswithoutcachewrite"),
    writeCache = col("inputtokenswithcachewrite"),
    readCache = col("cachereadtokens");
  if ([date, kind, cost].some((v) => v < 0) || !rows.length)
    throw new ApiError(400, "cursor_csv_columns_required");
  const groups = new Map();
  let earliest = null,
    latest = null;
  for (const row of rows) {
    if (row.length !== headers.length)
      throw new ApiError(400, "invalid_cursor_csv");
    const rawDate = row[date].trim();
    // Ambiguous local timestamps must not silently be reinterpreted as UTC.
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(rawDate))
      throw new ApiError(400, "cursor_csv_date_requires_timezone");
    const time = new Date(rawDate);
    if (
      !Number.isFinite(time.getTime()) ||
      rawDate.slice(0, 10) !==
        new Date(rawDate.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10)
    )
      throw new ApiError(400, "invalid_cursor_csv_date");
    const iso = time.toISOString();
    earliest = earliest === null || iso < earliest ? iso : earliest;
    latest = latest === null || iso > latest ? iso : latest;
    const rawKind = key(row[kind]);
    const type = ["included", "subscription", "includedusage"].includes(rawKind)
      ? "included"
      : ["ondemand", "usagebased", "usagebasedusage"].includes(rawKind)
        ? "on_demand"
        : "other";
    const name =
      model < 0
        ? "モデル未記載"
        : row[model].trim().slice(0, 120) || "モデル未記載";
    const month = iso.slice(0, 7),
      groupKey = JSON.stringify([month, type, name]);
    const g = groups.get(groupKey) || {
      month,
      type,
      model: name,
      calls: 0,
      cost_usd: 0,
      unknown_cost_rows: 0,
      total_tokens: 0,
      unknown_token_rows: 0,
    };
    const amount = number(row[cost], true);
    if (amount === null) g.unknown_cost_rows++;
    else g.cost_usd += amount;
    let tokens = total < 0 ? null : number(row[total]);
    if (tokens === null) {
      const inCols =
        input >= 0
          ? [input]
          : noCache >= 0 && writeCache >= 0 && readCache >= 0
            ? [noCache, writeCache, readCache]
            : [];
      const parts = [...inCols, ...(output >= 0 ? [output] : [])].map((i) =>
        number(row[i]),
      );
      if (inCols.length && output >= 0 && parts.every((n) => n !== null))
        tokens = parts.reduce((a, b) => a + b, 0);
    }
    if (tokens === null) g.unknown_token_rows++;
    else g.total_tokens += tokens;
    g.calls++;
    groups.set(groupKey, g);
    if (groups.size > 1000) throw new ApiError(413, "cursor_csv_too_many_rows");
  }
  return {
    currency: "USD",
    first_event_at: earliest,
    last_event_at: latest,
    rows: rows.length,
    groups: [...groups.values()],
  };
}
export async function importCursor(env, csv) {
  const payload = parseCursorCsv(csv),
    contentHash = await hash(csv);
  const existing = await env.DB.prepare(
    "SELECT payload FROM billing_snapshots WHERE provider='cursor'",
  ).first();
  if (existing && JSON.parse(existing.payload).content_hash === contentHash)
    return { unchanged: true, rows: payload.rows };
  const time = now();
  await env.DB.prepare(
    "INSERT INTO billing_snapshots(provider,payload,fetched_at,attempted_at,error_code) VALUES(?,?,?,?,NULL) ON CONFLICT(provider) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,attempted_at=excluded.attempted_at,error_code=NULL",
  )
    .bind(
      "cursor",
      JSON.stringify({ ...payload, content_hash: contentHash }),
      time,
      time,
    )
    .run();
  return { unchanged: false, rows: payload.rows };
}
// Monetary estimates are reference prices for known tokens, never invoices.
export function estimateModel(row) {
  if (row.input_tokens === null && row.output_tokens === null) return null;
  const i = row.input_tokens ?? 0,
    o = row.output_tokens ?? 0;
  if (row.provider === "gemini" && row.model === "gemini-3.1-flash-lite")
    return {
      currency: "USD",
      minimum: (i * 0.025 + o * 1.5) / 1e6,
      maximum: (i * 0.5 + o * 1.5) / 1e6,
      note: "取得済みトークン分の有料単価換算。音声・キャッシュの内訳未取得のため幅があります。未取得トークン・税・他の利用は含みません。",
    };
  return null;
}
export async function syncCloudflare(env) {
  if (
    !env.CLOUDFLARE_BILLING_TOKEN ||
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_BILLING_ACCOUNT_ID || "")
  )
    throw new ApiError(503, "cloudflare_billing_not_configured");
  const time = now();
  const claim = await env.DB.prepare(
    "INSERT INTO billing_snapshots(provider,attempted_at) VALUES('cloudflare',?) ON CONFLICT(provider) DO UPDATE SET attempted_at=excluded.attempted_at WHERE attempted_at<? RETURNING provider",
  )
    .bind(time, new Date(Date.now() - 60000).toISOString())
    .first();
  if (!claim) throw new ApiError(429, "billing_sync_wait");
  let payload = null,
    error = null;
  try {
    const entries = [];
    let complete = false;
    for (let page = 1; page <= 10; page++) {
      const url =
        "https://api.cloudflare.com/client/v4/accounts/" +
        env.CLOUDFLARE_BILLING_ACCOUNT_ID +
        "/billing/history?page=" +
        page +
        "&per_page=100";
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + env.CLOUDFLARE_BILLING_TOKEN },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        error =
          response.status === 401 || response.status === 403
            ? "billing_permission_denied"
            : "billing_provider_unavailable";
        break;
      }
      const data = await response.json();
      if (data.success !== true || !Array.isArray(data.result)) {
        error = "billing_response_invalid";
        break;
      }
      for (const r of data.result) {
        if (
          typeof r.amount !== "number" ||
          !Number.isFinite(r.amount) ||
          typeof r.currency !== "string" ||
          !/^[A-Z]{3}$/i.test(r.currency) ||
          !Number.isFinite(Date.parse(r.occurred_at))
        ) {
          error = "billing_response_invalid";
          break;
        }
        // Do not return/store invoice URLs, names, addresses or payment identifiers.
        entries.push({
          amount: r.amount,
          currency: r.currency.toUpperCase(),
          date: new Date(r.occurred_at).toISOString(),
          status: String(r.status || "unknown").slice(0, 50),
          type: String(r.type || "unknown").slice(0, 50),
        });
      }
      if (error) break;
      const count = Number(data.result_info?.total_count);
      if (
        data.result.length < 100 ||
        (Number.isFinite(count) && page * 100 >= count)
      ) {
        complete = true;
        break;
      }
    }
    if (!error) payload = { entries, complete, scope: "account" };
  } catch {
    error = "billing_provider_unavailable";
  }
  await env.DB.prepare(
    "INSERT INTO billing_snapshots(provider,payload,fetched_at,attempted_at,error_code) VALUES(?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET payload=COALESCE(excluded.payload,billing_snapshots.payload),fetched_at=COALESCE(excluded.fetched_at,billing_snapshots.fetched_at),attempted_at=excluded.attempted_at,error_code=excluded.error_code",
  )
    .bind(
      "cloudflare",
      payload ? JSON.stringify(payload) : null,
      payload ? time : null,
      time,
      error,
    )
    .run();
  return { ok: !error, code: error };
}
export async function billingOverview(env, requestedMonth) {
  const range = monthRange(requestedMonth),
    cfg = settings(env);
  if (
    env.CLOUDFLARE_BILLING_TOKEN &&
    /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_BILLING_ACCOUNT_ID || "")
  ) {
    const previous = await env.DB.prepare(
      "SELECT attempted_at FROM billing_snapshots WHERE provider='cloudflare'",
    ).first();
    if (!previous || Date.now() - Date.parse(previous.attempted_at) >= 900000)
      await syncCloudflare(env);
  }
  const models = (
    await env.DB.prepare(
      "SELECT provider,model,COUNT(*) AS calls,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL OR usage_estimated=1 THEN 1 ELSE 0 END) AS unknown_calls,SUM(reserved_tokens) AS reserved_tokens,SUM(CASE WHEN outcome IN ('quota','failed') THEN 1 ELSE 0 END) AS failed_calls FROM ai_usage WHERE day>=? AND day<? GROUP BY provider,model ORDER BY provider,model",
    )
      .bind(range.start, range.end)
      .all()
  ).results.map((r) => ({ ...r, estimate: estimateModel(r) }));
  const calls = (
    await env.DB.prepare(
      "SELECT service,operation,SUM(calls) AS calls FROM api_usage WHERE day>=? AND day<? GROUP BY service,operation",
    )
      .bind(range.start, range.end)
      .all()
  ).results;
  const daily = await env.DB.prepare("SELECT * FROM daily_budget WHERE day=?")
    .bind(now().slice(0, 10))
    .first();
  const snapshots = (
    await env.DB.prepare("SELECT * FROM billing_snapshots").all()
  ).results;
  const cursor = snapshots.find((r) => r.provider === "cursor"),
    cloudflare = snapshots.find((r) => r.provider === "cloudflare");
  const cursorData = cursor?.payload ? JSON.parse(cursor.payload) : null,
    cfData = cloudflare?.payload ? JSON.parse(cloudflare.payload) : null;
  const tier = ["free", "paid"].includes(env.GEMINI_BILLING_TIER)
    ? env.GEMINI_BILLING_TIER
    : "unknown";
  return {
    month: range.month,
    generated_at: now(),
    pricing_date: pricingDate,
    local: {
      models,
      calls,
      scope:
        "この管理Worker経由の利用だけ。他のアプリ・同じキーの利用は含みません。",
      daily: {
        day: now().slice(0, 10),
        calls: daily?.calls ?? 0,
        reserved_tokens: daily?.tokens_reserved ?? 0,
        call_limit: cfg.dailyCalls,
        token_limit: cfg.dailyTokens,
      },
    },
    cursor: {
      status: cursorData ? "imported" : "not_imported",
      fetched_at: cursor?.fetched_at ?? null,
      first_event_at: cursorData?.first_event_at ?? null,
      last_event_at: cursorData?.last_event_at ?? null,
      groups: cursorData?.groups.filter((r) => r.month === range.month) ?? [],
      remaining: null,
      link: "https://cursor.com/dashboard",
      note: "個人Proの残量取得APIは未提供。CSVはアカウント全体の利用履歴で、請求書や現在の残量ではありません。契約の利用枠はSpendingで確認してください。",
    },
    cloudflare: {
      status: cloudflare?.error_code
        ? "error"
        : cfData
          ? "connected"
          : "not_configured",
      fetched_at: cloudflare?.fetched_at ?? null,
      error_code: cloudflare?.error_code ?? null,
      complete: cfData?.complete ?? false,
      entries:
        cfData?.entries.filter((r) => r.date.slice(0, 7) === range.month) ?? [],
      can_sync: !!(
        env.CLOUDFLARE_BILLING_TOKEN &&
        /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_BILLING_ACCOUNT_ID || "")
      ),
      note: "Cloudflareアカウント全体の請求履歴。他のサイトも含み、当月の未確定利用量とは異なります。",
    },
    gemini: {
      tier,
      remaining: null,
      invoice: null,
      link: "https://aistudio.google.com/usage",
      note: "Geminiアプリの有料契約とAPIの課金は別です。APIの契約・残高・請求はAI Studioで確認してください。無料枠の上限はプロジェクトとモデルごとに異なります。",
    },
    services: [
      {
        name: "Workers AI",
        allowance: "アカウント全体で10,000 Neurons / 日",
        reset: "日本時間09:00（UTC 00:00）",
        remaining: null,
        condition:
          "Freeでは超過すると停止。Paidでは無料割当を超えた分に課金。埋め込みのトークンが未取得の場合、残量は計算できません。",
        link: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
      },
      {
        name: "YouTube Data API",
        allowance:
          "使用中のlist APIは通常10,000 units / 日（プロジェクト全体）",
        reset: "米国太平洋時間の午前0時",
        remaining: null,
        condition:
          "このサイトのchannels.list・playlistItems.list・videos.listは各1 unit。上限超過は停止で、有料枠への自動切り替えではありません。記録は今回の追加以降です。",
        link: "https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas",
      },
      {
        name: "Turnstile",
        allowance: "Freeプランはチャレンジ回数の制限なし",
        reset: "なし",
        remaining: null,
        condition:
          "トークン課金のAIではありません。Enterpriseは個別契約です。表示回数とサーバー検証回数は別です。",
        link: "https://developers.cloudflare.com/turnstile/plans/",
      },
      {
        name: "Workers / D1",
        allowance: "契約・サービスごとに異なります",
        reset: "日次 / 請求期間",
        remaining: null,
        condition:
          "トークン課金ではありません。使用量はCloudflareで確認し、請求履歴は上の連携で取得します。",
        link: "https://dash.cloudflare.com/",
      },
      {
        name: "GitHub / Actions",
        allowance: "契約・リポジトリにより異なります",
        reset: "請求期間",
        remaining: null,
        condition:
          "API制限とActionsの分数・ストレージ課金は別です。請求連携は未接続です。",
        link: "https://github.com/settings/billing",
      },
    ],
  };
}
