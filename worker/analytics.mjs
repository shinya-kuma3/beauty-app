// Public-site traffic from Cloudflare zone analytics (my-beauty-palette.com).
// Only aggregates are fetched and cached; no IPs, user agents or request bodies.
import { ApiError, now } from "./core.mjs";

export const dailyPeriods = [7, 30, 90];
export const pagePeriods = [1, 3, 7, 30, 90];
const CACHE_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const zoneId = (env) => env.CLOUDFLARE_ANALYTICS_ZONE_ID || "";
export const analyticsConfigured = (env) =>
  !!env.CLOUDFLARE_ANALYTICS_TOKEN && /^[a-f0-9]{32}$/.test(zoneId(env));
const knownErrors = new Set([
  "analytics_permission_denied",
  "analytics_provider_rate_limited",
  "analytics_provider_unavailable",
  "analytics_response_invalid",
  "analytics_query_failed",
  "analytics_zone_unavailable",
]);
const count = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const day = (offset) =>
  new Date(Date.parse(now().slice(0, 10) + "T00:00:00Z") - offset * 86400000)
    .toISOString()
    .slice(0, 10);

function providerMessage(env, error) {
  // Shown to admins only, so a refused time range can be read on screen.
  const message = typeof error?.provider === "string" ? error.provider : "";
  let safe = message;
  if (env.CLOUDFLARE_ANALYTICS_TOKEN)
    safe = safe.split(env.CLOUDFLARE_ANALYTICS_TOKEN).join("[hidden]");
  return safe.replace(/[A-Za-z0-9_-]{32,}/g, "[hidden]").slice(0, 240) || null;
}
async function graphql(env, query) {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/graphql",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.CLOUDFLARE_ANALYTICS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { zoneTag: zoneId(env) } }),
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? "analytics_permission_denied"
        : response.status === 429
          ? "analytics_provider_rate_limited"
          : "analytics_provider_unavailable",
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("analytics_response_invalid");
  }
  if (Array.isArray(data.errors) && data.errors.length) {
    const error = new Error("analytics_query_failed");
    error.provider = String(data.errors[0]?.message ?? "");
    throw error;
  }
  const zones = data.data?.viewer?.zones;
  if (!Array.isArray(zones) || zones.length !== 1)
    throw new Error("analytics_zone_unavailable");
  return zones[0];
}

async function fetchDaily(env, days) {
  const start = day(days - 1),
    end = day(0);
  const zone = await graphql(
    env,
    `query SiteDaily($zoneTag: string!) { viewer { zones(filter: {zoneTag: $zoneTag}) {
  days: httpRequests1dGroups(limit: ${days}, filter: {date_geq: "${start}", date_leq: "${end}"}, orderBy: [date_ASC]) {
   dimensions { date } sum { requests pageViews } uniq { uniques } } } } }`,
  );
  if (!Array.isArray(zone.days)) throw new Error("analytics_response_invalid");
  const byDate = new Map();
  for (const row of zone.days) {
    const date = row?.dimensions?.date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error("analytics_response_invalid");
    byDate.set(date, {
      requests: count(row.sum?.requests),
      page_views: count(row.sum?.pageViews),
      visitors: count(row.uniq?.uniques),
    });
  }
  // Days Cloudflare did not return stay null: "no data" is not the same as zero.
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = day(i);
    series.push({
      date,
      ...(byDate.get(date) ?? {
        requests: null,
        page_views: null,
        visitors: null,
      }),
    });
  }
  return { start, end, series };
}

async function fetchPages(env, days) {
  const end = now();
  const start = new Date(Date.parse(end) - days * 86400000).toISOString();
  const zone = await graphql(
    env,
    `query SitePages($zoneTag: string!) { viewer { zones(filter: {zoneTag: $zoneTag}) {
  pages: httpRequestsAdaptiveGroups(limit: 100, filter: {datetime_geq: "${start}", datetime_lt: "${end}", requestSource: "eyeball", clientRequestHTTPMethodName: "GET", edgeResponseStatus: 200, clientRequestPath_like: "/articles/%"}, orderBy: [count_DESC]) {
   count dimensions { clientRequestPath } } } } }`,
  );
  if (!Array.isArray(zone.pages)) throw new Error("analytics_response_invalid");
  const views = new Map();
  for (const row of zone.pages) {
    const path = row?.dimensions?.clientRequestPath;
    const match =
      typeof path === "string" &&
      /^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path);
    if (!match) continue;
    views.set(match[1], (views.get(match[1]) ?? 0) + (count(row.count) ?? 0));
  }
  const slugs = [...views.keys()];
  const titles = new Map();
  if (slugs.length) {
    const found = await env.DB.prepare(
      `SELECT slug,title FROM articles WHERE slug IN (${slugs.map(() => "?").join(",")})`,
    )
      .bind(...slugs)
      .all();
    for (const row of found.results ?? []) titles.set(row.slug, row.title);
  }
  return {
    start,
    end,
    pages: slugs
      .map((slug) => ({
        slug,
        path: "/articles/" + slug + "/",
        title: titles.get(slug) ?? null,
        views: views.get(slug),
      }))
      .sort((a, b) => b.views - a.views || a.slug.localeCompare(b.slug))
      .slice(0, 50),
  };
}

const key = (env, kind, days) =>
  "site-analytics:" + zoneId(env) + ":" + kind + ":" + days;
async function cached(env, provider) {
  const row = await env.DB.prepare(
    "SELECT * FROM billing_snapshots WHERE provider=?",
  )
    .bind(provider)
    .first();
  let data = null;
  try {
    data = row?.payload ? JSON.parse(row.payload) : null;
  } catch {}
  return { row, data };
}
async function load(env, kind, days, fetcher, role, refresh) {
  const base = { configured: analyticsConfigured(env), days };
  if (!base.configured)
    return { ...base, data: null, fetched_at: null, error_code: null };
  const provider = key(env, kind, days);
  let current = await cached(env, provider);
  const fresh =
    current.row?.fetched_at &&
    Date.now() - Date.parse(current.row.fetched_at) < CACHE_MS;
  let error_code = current.row?.error_code ?? null,
    provider_message = null;
  if (!fresh || refresh) {
    const time = now();
    const claim = await env.DB.prepare(
      "INSERT INTO billing_snapshots(provider,attempted_at) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET attempted_at=excluded.attempted_at WHERE attempted_at<? RETURNING provider",
    )
      .bind(provider, time, new Date(Date.now() - RETRY_MS).toISOString())
      .first();
    if (claim) {
      try {
        const data = await fetcher(env, days);
        await env.DB.prepare(
          "UPDATE billing_snapshots SET payload=?,fetched_at=?,error_code=NULL WHERE provider=?",
        )
          .bind(JSON.stringify(data), time, provider)
          .run();
        error_code = null;
      } catch (error) {
        error_code = knownErrors.has(error?.message)
          ? error.message
          : "analytics_provider_unavailable";
        if (role === "admin") provider_message = providerMessage(env, error);
        await env.DB.prepare(
          "UPDATE billing_snapshots SET error_code=? WHERE provider=?",
        )
          .bind(error_code, provider)
          .run();
      }
      current = await cached(env, provider);
    } else if (refresh && !current.data)
      throw new ApiError(429, "analytics_sync_wait");
  }
  return {
    ...base,
    data: current.data,
    fetched_at: current.row?.fetched_at ?? null,
    error_code,
    provider_message,
    stale:
      !!current.data &&
      (!!error_code ||
        Date.now() - Date.parse(current.row.fetched_at) >= CACHE_MS),
  };
}
export async function siteAnalytics(env, query = {}, role = "editor") {
  const days = Number(query.days || 30);
  if (!dailyPeriods.includes(days)) throw new ApiError(400, "invalid_period");
  return load(env, "daily", days, fetchDaily, role, query.refresh === "1");
}
export async function pageAnalytics(env, query = {}, role = "editor") {
  const days = Number(query.days || 7);
  if (!pagePeriods.includes(days)) throw new ApiError(400, "invalid_period");
  return load(env, "pages", days, fetchPages, role, query.refresh === "1");
}
