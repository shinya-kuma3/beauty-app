// Starts the "Approved article publication" workflow right after a publication step
// (human approval, Grok pass, withdrawal) instead of waiting for GitHub's best-effort
// schedule, which can lag by hours. The schedule stays as a fallback.
const API = "https://api.github.com";
export const publicationWorkflow = "content-release.yml";
const known = new Set([
  "dispatch_permission_denied",
  "dispatch_not_found",
  "dispatch_rejected",
  "dispatch_unavailable",
  "dispatch_key_invalid",
]);
export const dispatchConfigured = (env) =>
  /^\d+$/.test(env.GITHUB_DISPATCH_APP_ID || "") &&
  /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_DISPATCH_REPOSITORY || "") &&
  typeof env.GITHUB_DISPATCH_PRIVATE_KEY === "string" &&
  env.GITHUB_DISPATCH_PRIVATE_KEY.includes("PRIVATE KEY");

const encoder = new TextEncoder();
function base64url(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const json64 = (value) => base64url(encoder.encode(JSON.stringify(value)));
function derLength(length) {
  if (length < 128) return [length];
  const bytes = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 255);
  return [0x80 | bytes.length, ...bytes];
}
// GitHub issues PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto imports PKCS#8, so wrap it.
export function privateKeyDer(pem) {
  const text = pem.replace(/\\n/g, "\n");
  const body = text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  let der;
  try {
    der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("dispatch_key_invalid");
  }
  if (!/BEGIN RSA PRIVATE KEY/.test(text)) return der;
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const inner = [0x02, 0x01, 0x00, ...algorithm, 0x04, ...derLength(der.length), ...der];
  return Uint8Array.from([0x30, ...derLength(inner.length), ...inner]);
}
async function appJwt(env) {
  let key;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyDer(env.GITHUB_DISPATCH_PRIVATE_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error("dispatch_key_invalid");
  }
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    json64({ alg: "RS256", typ: "JWT" }) +
    "." +
    json64({ iat: now - 60, exp: now + 540, iss: env.GITHUB_DISPATCH_APP_ID });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsigned),
  );
  return unsigned + "." + base64url(new Uint8Array(signature));
}
async function github(path, token, method = "GET", body) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "beauty-app-admin",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? "dispatch_permission_denied"
        : response.status === 404
          ? "dispatch_not_found"
          : response.status === 422
            ? "dispatch_rejected"
            : "dispatch_unavailable",
    );
  return response.status === 204 ? null : response.json();
}
// Never throws: a failed dispatch must not undo an approval; the schedule picks it up later.
export async function dispatchPublication(env, reason) {
  if (env.CONTENT_DELIVERY_MODE !== "github" || !dispatchConfigured(env))
    return { state: "skipped" };
  const repository = env.GITHUB_DISPATCH_REPOSITORY;
  try {
    const jwt = await appJwt(env);
    const installation = await github("/repos/" + repository + "/installation", jwt);
    const access = await github(
      "/app/installations/" + installation.id + "/access_tokens",
      jwt,
      "POST",
      {
        repositories: [repository.split("/")[1]],
        permissions: { actions: "write" },
      },
    );
    await github(
      "/repos/" + repository + "/actions/workflows/" + publicationWorkflow + "/dispatches",
      access.token,
      "POST",
      { ref: "main" },
    );
    return { state: "dispatched", reason };
  } catch (error) {
    const code = known.has(error?.message) ? error.message : "dispatch_unavailable";
    console.error(JSON.stringify({ event: "publication_dispatch_failed", reason, code }));
    return { state: "failed", reason, error_code: code };
  }
}
