import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { dispatchPublication, dispatchConfigured } from "../worker/github-dispatch.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" });
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" });
const env = (overrides = {}) => ({
  CONTENT_DELIVERY_MODE: "github",
  GITHUB_DISPATCH_APP_ID: "123456",
  GITHUB_DISPATCH_REPOSITORY: "owner/beauty-app",
  GITHUB_DISPATCH_PRIVATE_KEY: pkcs1,
  ...overrides,
});
const realFetch = globalThis.fetch;
let calls = [],
  mode = "ok";
test.beforeEach(() => {
  calls = [];
  mode = "ok";
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (mode === "forbidden") return Response.json({}, { status: 403 });
    if (String(url).endsWith("/repos/owner/beauty-app/installation"))
      return Response.json({ id: 42 });
    if (String(url).endsWith("/app/installations/42/access_tokens"))
      return Response.json({ token: "installation-token" }, { status: 201 });
    if (String(url).endsWith("/actions/workflows/content-release.yml/dispatches"))
      return new Response(null, { status: 204 });
    return Response.json({}, { status: 404 });
  };
});
test.after(() => {
  globalThis.fetch = realFetch;
});
function verifyJwt(header) {
  const jwt = header.replace(/^Bearer /, "");
  const [head, body, signature] = jwt.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(head + "." + body);
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, "base64url")));
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  assert.equal(payload.iss, "123456");
  assert.ok(payload.exp - payload.iat <= 600);
  return payload;
}

test("GitHub Appの署名付きトークンで、mainの公開ワークフローだけを呼び出す", async () => {
  const result = await dispatchPublication(env(), "approved");
  assert.deepEqual(result, { state: "dispatched", reason: "approved" });
  assert.equal(calls.length, 3);
  verifyJwt(calls[0].options.headers.Authorization);
  verifyJwt(calls[1].options.headers.Authorization);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    repositories: ["beauty-app"],
    permissions: { actions: "write" },
  });
  assert.equal(
    calls[2].url,
    "https://api.github.com/repos/owner/beauty-app/actions/workflows/content-release.yml/dispatches",
  );
  assert.equal(calls[2].options.headers.Authorization, "Bearer installation-token");
  assert.deepEqual(JSON.parse(calls[2].options.body), { ref: "main" });
});

test("PKCS#8形式や、改行を\\nで書いた秘密鍵でも署名できる", async () => {
  for (const key of [pkcs8, pkcs1.replace(/\r?\n/g, "\\n")]) {
    calls = [];
    const result = await dispatchPublication(env({ GITHUB_DISPATCH_PRIVATE_KEY: key }), "grok_passed");
    assert.equal(result.state, "dispatched");
    verifyJwt(calls[0].options.headers.Authorization);
  }
});

test("未設定やGitHub以外の配信では呼び出さず、失敗しても例外にせず原因だけ返す", async () => {
  assert.equal(dispatchConfigured(env({ GITHUB_DISPATCH_APP_ID: "" })), false);
  assert.deepEqual(await dispatchPublication(env({ GITHUB_DISPATCH_PRIVATE_KEY: "" }), "approved"), { state: "skipped" });
  assert.deepEqual(await dispatchPublication(env({ CONTENT_DELIVERY_MODE: "hook" }), "approved"), { state: "skipped" });
  assert.equal(calls.length, 0);
  mode = "forbidden";
  const failed = await dispatchPublication(env(), "withdrawal");
  assert.deepEqual(failed, { state: "failed", reason: "withdrawal", error_code: "dispatch_permission_denied" });
  const broken = await dispatchPublication(
    env({ GITHUB_DISPATCH_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nnot-a-key\n-----END RSA PRIVATE KEY-----" }),
    "approved",
  );
  assert.equal(broken.error_code, "dispatch_key_invalid");
});
