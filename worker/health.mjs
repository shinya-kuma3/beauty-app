import { ApiError, now } from "./core.mjs";

export const freeLimits = {
  workers_requests: 100000,
  d1_rows_read: 5000000,
  d1_rows_written: 100000,
  d1_storage: 5000000000,
  d1_database_storage: 500000000,
};
const checkedAt = "2026-10-20";
const CACHE_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MAX_DATABASES = 20;
const accountId = (env) =>
  env.CLOUDFLARE_MONITOR_ACCOUNT_ID || env.CLOUDFLARE_BILLING_ACCOUNT_ID || "";
const configured = (env) =>
  !!env.CLOUDFLARE_ANALYTICS_TOKEN && /^[a-f0-9]{32}$/.test(accountId(env));
const cacheKey = (env) => "cloudflare-health:" + accountId(env);
const count = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const text = (value, max = 160) =>
  typeof value === "string" ? value.slice(0, max) : "";
function requireCount(value) {
  const result = count(value);
  if (result === null) throw new Error("monitor_response_invalid");
  return result;
}
function rows(value) {
  if (!Array.isArray(value)) throw new Error("monitor_response_invalid");
  return value;
}
export function quota(used, limit) {
  if (used === null || used === undefined)
    return {
      used: null,
      limit,
      remaining: null,
      percent: null,
      state: "unknown",
    };
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    percent: (used / limit) * 100,
    state:
      used >= limit ? "exceeded" : used >= limit * 0.8 ? "warning" : "normal",
  };
}
function range() {
  const end = now();
  return {
    day: end.slice(0, 10),
    start: end.slice(0, 10) + "T00:00:00.000Z",
    end,
    reset_at: new Date(
      Date.parse(end.slice(0, 10) + "T00:00:00Z") + 86400000,
    ).toISOString(),
  };
}
async function cf(env, path, body) {
  const response = await fetch("https://api.cloudflare.com/client/v4/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + env.CLOUDFLARE_ANALYTICS_TOKEN,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? "monitor_permission_denied"
        : response.status === 429
          ? "monitor_provider_rate_limited"
          : "monitor_provider_unavailable",
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("monitor_response_invalid");
  }
  if (Array.isArray(data.errors) && data.errors.length)
    throw new Error("monitor_query_failed");
  if (body) {
    const accounts = data.data?.viewer?.accounts;
    if (!Array.isArray(accounts) || accounts.length !== 1)
      throw new Error("monitor_account_unavailable");
    return accounts[0];
  }
  if (data.success !== true) throw new Error("monitor_response_invalid");
  return data;
}
const workersQuery = `query HealthWorkers($accountTag: string!, $start: string!, $end: string!) {
 viewer { accounts(filter: {accountTag: $accountTag}) {
  total: workersInvocationsAdaptive(limit: 1, filter: {datetime_geq: $start, datetime_leq: $end}) {sum {requests errors}}
  workers: workersInvocationsAdaptive(limit: 1000, filter: {datetime_geq: $start, datetime_leq: $end}) {sum {requests errors} dimensions {scriptName status}}
  hourly: workersInvocationsAdaptive(limit: 24, filter: {datetime_geq: $start, datetime_leq: $end}, orderBy: [datetimeHour_ASC]) {sum {requests errors} dimensions {datetimeHour}}
 }}
}`;
const d1Query = `query HealthD1($accountTag: string!, $day: Date!) {
 viewer { accounts(filter: {accountTag: $accountTag}) {
  total: d1AnalyticsAdaptiveGroups(limit: 1, filter: {date_geq: $day, date_leq: $day}) {sum {rowsRead rowsWritten readQueries writeQueries}}
  databases: d1AnalyticsAdaptiveGroups(limit: 1000, filter: {date_geq: $day, date_leq: $day}) {sum {rowsRead rowsWritten readQueries writeQueries} quantiles {queryBatchTimeMsP90} dimensions {databaseId}}
  hourly: d1AnalyticsAdaptiveGroups(limit: 24, filter: {date_geq: $day, date_leq: $day}, orderBy: [datetimeHour_ASC]) {sum {rowsRead rowsWritten readQueries writeQueries} dimensions {datetimeHour}}
 }}
}`;
function aggregate(list, keys) {
  return rows(list).reduce(
    (acc, row) => {
      for (const key of keys) acc[key] += requireCount(row.sum?.[key]);
      return acc;
    },
    Object.fromEntries(keys.map((key) => [key, 0])),
  );
}
async function workers(env, period) {
  const data = await cf(env, "graphql", {
    query: workersQuery,
    variables: {
      accountTag: accountId(env),
      start: period.start,
      end: period.end,
    },
  });
  const total = aggregate(data.total, ["requests", "errors"]);
  const list = rows(data.workers).map((row) => ({
    name: text(row.dimensions?.scriptName),
    status: text(row.dimensions?.status, 80),
    ...aggregate([row], ["requests", "errors"]),
  }));
  return {
    ...total,
    workers: list,
    detail_complete: list.length < 1000,
    hourly: rows(data.hourly).map((row) => ({
      hour: text(row.dimensions?.datetimeHour, 40),
      ...aggregate([row], ["requests", "errors"]),
    })),
  };
}
async function d1(env, period) {
  const data = await cf(env, "graphql", {
    query: d1Query,
    variables: { accountTag: accountId(env), day: period.day },
  });
  const keys = ["rowsRead", "rowsWritten", "readQueries", "writeQueries"];
  const total = aggregate(data.total, keys);
  const list = rows(data.databases).map((row) => ({
    id: text(row.dimensions?.databaseId, 64),
    ...aggregate([row], keys),
    p90_ms: count(row.quantiles?.queryBatchTimeMsP90),
  }));
  return {
    ...total,
    databases: list,
    detail_complete: list.length < 1000,
    hourly: rows(data.hourly).map((row) => ({
      hour: text(row.dimensions?.datetimeHour, 40),
      ...aggregate([row], keys),
    })),
  };
}
async function storage(env) {
  // List is unfiltered so quotas include other projects in the same account.
  const listing = await cf(
    env,
    "accounts/" + accountId(env) + "/d1/database?per_page=100&page=1",
  );
  const all = rows(listing.result);
  const totalCount = count(listing.result_info?.total_count);
  const listComplete =
    all.length < 100 && (totalCount === null || totalCount === all.length);
  const selected = all.slice(0, MAX_DATABASES);
  const databases = await Promise.all(
    selected.map(async (row) => {
      if (typeof row.uuid !== "string" || !/^[a-f0-9-]{36}$/i.test(row.uuid))
        throw new Error("monitor_response_invalid");
      const id = row.uuid;
      try {
        const detail = await cf(
          env,
          "accounts/" +
            accountId(env) +
            "/d1/database/" +
            id +
            "?fields=uuid,name,file_size",
        );
        return {
          id,
          name: text(detail.result?.name || row.name),
          bytes: requireCount(detail.result?.file_size),
          error_code: null,
        };
      } catch (error) {
        return {
          id,
          name: text(row.name),
          bytes: null,
          error_code: safeError(error),
        };
      }
    }),
  );
  const complete =
    listComplete &&
    all.length <= MAX_DATABASES &&
    databases.every((row) => row.bytes !== null);
  return {
    databases,
    complete,
    total_bytes: complete
      ? databases.reduce((n, row) => n + row.bytes, 0)
      : null,
  };
}
const knownErrors = new Set([
  "monitor_response_invalid",
  "monitor_permission_denied",
  "monitor_provider_rate_limited",
  "monitor_provider_unavailable",
  "monitor_query_failed",
  "monitor_account_unavailable",
]);
function safeError(error) {
  return knownErrors.has(error?.message)
    ? error.message
    : "monitor_provider_unavailable";
}
async function snapshot(env) {
  const row = await env.DB.prepare(
    "SELECT * FROM billing_snapshots WHERE provider=?",
  )
    .bind(cacheKey(env))
    .first();
  let data = null;
  try {
    data = row?.payload ? JSON.parse(row.payload) : null;
  } catch {}
  return { row, data };
}
export async function syncHealth(env) {
  if (!configured(env)) throw new ApiError(503, "monitor_not_configured");
  const period = range(),
    time = now();
  const claim = await env.DB.prepare(
    "INSERT INTO billing_snapshots(provider,attempted_at) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET attempted_at=excluded.attempted_at WHERE attempted_at<? RETURNING provider",
  )
    .bind(cacheKey(env), time, new Date(Date.now() - RETRY_MS).toISOString())
    .first();
  if (!claim) throw new ApiError(429, "monitor_sync_wait");
  const { data: old } = await snapshot(env);
  const result = {
    day: period.day,
    start: period.start,
    end: period.end,
    segments: {},
  };
  const names = ["workers", "d1", "storage"];
  const settled = await Promise.allSettled([
    workers(env, period),
    d1(env, period),
    storage(env),
  ]);
  settled.forEach((item, i) => {
    const name = names[i];
    const previous = old?.segments?.[name];
    result.segments[name] =
      item.status === "fulfilled"
        ? {
            data: item.value,
            fetched_at: time,
            attempted_at: time,
            error_code: null,
          }
        : {
            data: previous?.data ?? null,
            fetched_at: previous?.fetched_at ?? null,
            attempted_at: time,
            error_code: safeError(item.reason),
          };
    // A previous UTC day must never look like today's usage.
    if (
      name !== "storage" &&
      item.status === "rejected" &&
      old?.day !== period.day
    ) {
      result.segments[name].data = null;
      result.segments[name].fetched_at = null;
    }
  });
  await env.DB.prepare(
    "UPDATE billing_snapshots SET payload=?,fetched_at=?,error_code=NULL WHERE provider=? AND attempted_at=?",
  )
    .bind(JSON.stringify(result), time, cacheKey(env), time)
    .run();
  return {
    ok: names.every((name) => !result.segments[name].error_code),
    ...(await healthOverview(env, false)),
  };
}
export async function recordHttpFailure(env) {
  // Only errors create writes; do not turn ordinary static/API reads into monitoring writes.
  try {
    await env.DB.prepare(
      "INSERT INTO api_usage(day,service,operation,calls) VALUES(?,'worker-http-errors','http_5xx',1) ON CONFLICT(day,service,operation) DO UPDATE SET calls=calls+1",
    )
      .bind(now().slice(0, 10))
      .run();
  } catch {
    /* An exhausted/unavailable DB must not prevent the original error response. */
  }
}
export async function healthOverview(env, refresh = true) {
  const period = range();
  let current = await snapshot(env);
  if (
    refresh &&
    configured(env) &&
    (!current.row ||
      Date.now() - Date.parse(current.row.attempted_at) >= CACHE_MS)
  ) {
    try {
      await syncHealth(env);
    } catch (error) {
      if (error?.code !== "monitor_sync_wait") throw error;
    }
    current = await snapshot(env);
  }
  const data = current.data;
  const segments = Object.fromEntries(
    ["workers", "d1", "storage"].map((name) => {
      const segment = data?.segments?.[name];
      const valid = name === "storage" || data?.day === period.day;
      return [
        name,
        {
          data: valid ? (segment?.data ?? null) : null,
          fetched_at: valid ? (segment?.fetched_at ?? null) : null,
          error_code: segment?.error_code ?? null,
          stale:
            !!segment?.data &&
            (!valid ||
              !!segment.error_code ||
              Date.now() - Date.parse(segment.fetched_at) > CACHE_MS),
        },
      ];
    }),
  );
  const local = await env.DB.prepare(
    "SELECT calls FROM api_usage WHERE day=? AND service='worker-http-errors' AND operation='http_5xx'",
  )
    .bind(period.day)
    .first();
  const plan = ["free", "paid"].includes(env.CLOUDFLARE_WORKERS_PLAN)
    ? env.CLOUDFLARE_WORKERS_PLAN
    : "unknown";
  return {
    configured: configured(env),
    plan,
    limits_checked_at: checkedAt,
    environment: env.PIPELINE_ENV || "unknown",
    day: period.day,
    start: period.start,
    end: data?.day === period.day ? data.end : period.end,
    reset_at: period.reset_at,
    last_attempt_at: current.row?.attempted_at ?? null,
    local_http_errors: local?.calls ?? 0,
    account_id: accountId(env),
    worker_names: (env.CLOUDFLARE_MONITOR_WORKER_NAMES || "beauty-app")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    database_id: env.CLOUDFLARE_MONITOR_DATABASE_ID || null,
    segments,
    quotas: {
      workers: quota(
        segments.workers.data?.requests ?? null,
        freeLimits.workers_requests,
      ),
      reads: quota(segments.d1.data?.rowsRead ?? null, freeLimits.d1_rows_read),
      writes: quota(
        segments.d1.data?.rowsWritten ?? null,
        freeLimits.d1_rows_written,
      ),
      storage: quota(
        segments.storage.data?.total_bytes ?? null,
        freeLimits.d1_storage,
      ),
    },
    links: {
      workers:
        "https://dash.cloudflare.com/" + accountId(env) + "/workers-and-pages",
      d1: "https://dash.cloudflare.com/" + accountId(env) + "/workers/d1",
      tokens: "https://dash.cloudflare.com/profile/api-tokens",
    },
  };
}
