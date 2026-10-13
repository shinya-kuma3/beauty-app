import { z } from "zod";
import { ApiError, now } from "./core.mjs";
async function digest(text) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
const defaults = [
  "https://my-beauty-palette.com",
  "https://mens.my-beauty-palette.com",
  "https://develop-beauty-app.sinyak4649.workers.dev",
  "https://codex-content-review-pipeline-beauty-app.sinyak4649.workers.dev",
];
export function allowedOrigin(origin, env) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return false;
    return (
      defaults.includes(origin) ||
      (env.PIPELINE_ENV === "development" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}
const optional = (max) => z.string().trim().max(max).optional().default("");
const schema = z
  .object({
    id: z.uuid(),
    name: optional(80),
    email: optional(254).refine((v) => !v || z.email().safeParse(v).success),
    message: z.string().trim().min(1).max(5000),
    token: z.string().min(1).max(2048),
    company_website: optional(200),
  })
  .strict();
async function bucket(db, key, windowSeconds, limit, time) {
  const slot = Math.floor(time / (windowSeconds * 1000));
  const result = await db
    .prepare(
      "INSERT INTO rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits",
    )
    .bind(
      "feedback:" + key + ":" + slot,
      new Date((slot + 1) * windowSeconds * 1000).toISOString(),
    )
    .first();
  if (result.hits > limit) throw new ApiError(429, "feedback_rate_limited");
}
export async function submitFeedback(env, input, origin, ip) {
  if (!allowedOrigin(origin, env)) throw new ApiError(403, "invalid_origin");
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY)
    throw new ApiError(503, "feedback_not_configured");
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "invalid_feedback");
  const data = parsed.data;
  if (data.company_website) throw new ApiError(400, "invalid_feedback");
  const time = Date.now();
  await env.DB.prepare(
    "DELETE FROM rate_limits WHERE bucket IN (SELECT bucket FROM rate_limits WHERE expires_at<? LIMIT 50)",
  )
    .bind(now())
    .run();
  await bucket(env.DB, "global", 3600, 200, time);
  const ipHash = await digest(
    env.TURNSTILE_SECRET_KEY + ":" + (ip || "unknown"),
  );
  await bucket(env.DB, ipHash, 900, 3, time);
  await bucket(env.DB, ipHash, 86400, 10, time);
  const hash = await digest(
    JSON.stringify([data.name, data.email, data.message]),
  );
  const existing = await env.DB.prepare(
    "SELECT payload_hash FROM feedback WHERE id=?",
  )
    .bind(data.id)
    .first();
  if (existing) {
    if (existing.payload_hash !== hash)
      throw new ApiError(409, "feedback_id_conflict");
    return { ok: true };
  }
  let check;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: data.token,
          ...(ip ? { remoteip: ip } : {}),
          idempotency_key: data.id,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error();
    check = await response.json();
  } catch {
    throw new ApiError(503, "feedback_verification_unavailable");
  }
  if (
    check.success !== true ||
    check.hostname !== new URL(origin).hostname ||
    check.action !== "feedback"
  )
    throw new ApiError(400, "feedback_verification_failed");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO feedback(id,name,email,message,payload_hash,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      data.id,
      data.name || null,
      data.email || null,
      data.message,
      hash,
      now(),
    )
    .run();
  // Verify the winning payload if concurrent requests used the same id.
  const stored = await env.DB.prepare(
    "SELECT payload_hash FROM feedback WHERE id=?",
  )
    .bind(data.id)
    .first();
  if (stored.payload_hash !== hash)
    throw new ApiError(409, "feedback_id_conflict");
  return { ok: true };
}
export async function listFeedback(db, query) {
  const status = query.status || "new";
  if (!["new", "read", "all"].includes(status))
    throw new ApiError(400, "invalid_status");
  const limit = Number(query.limit || 30),
    offset = Number(query.offset || 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 1000000
  )
    throw new ApiError(400, "invalid_pagination");
  const where = status === "all" ? "" : " WHERE status=?",
    params = status === "all" ? [] : [status];
  const items = await db
    .prepare(
      "SELECT id,name,email,message,status,created_at,reviewed_at,reviewed_by FROM feedback" +
        where +
        " ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
    )
    .bind(...params, limit, offset)
    .all();
  const total = await db
    .prepare("SELECT count(*) AS n FROM feedback" + where)
    .bind(...params)
    .first();
  const unread = await db
    .prepare("SELECT count(*) AS n FROM feedback WHERE status='new'")
    .first();
  return {
    items: items.results,
    total: total.n,
    unread: unread.n,
    limit,
    offset,
  };
}
