import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");
const [source, manifestText] = await Promise.all([readFile(workerPath, "utf8"), readFile(manifestPath, "utf8")]);
const manifest = JSON.parse(manifestText);

assert.equal(manifest.project_id, "appgprj_6ace61f3de308191b7221c8a2c76b38a");
assert.equal(manifest.static, undefined, "Worker manifests must not retain static hosting configuration");
assert.doesNotMatch(source, /GEMINI_API_KEY\s*[:=]\s*["'][^"']+["']/, "A Gemini key must never be bundled into the Worker source");

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(typeof workerModule.default?.fetch, "function");

const page = await workerModule.default.fetch(new Request("https://mira.test/"), {}, {});
assert.equal(page.status, 200);
assert.match(await page.text(), /A calm space to be heard/);

const script = await workerModule.default.fetch(new Request("https://mira.test/app.js"), {}, {});
assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
assert.match(await script.text(), /\/api\/gemini-token/);

const rejected = await workerModule.default.fetch(new Request("https://mira.test/api/gemini-token", { method: "POST" }), { GEMINI_API_KEY: "test-only" }, {});
assert.equal(rejected.status, 403);

const missingSecret = await workerModule.default.fetch(new Request("https://mira.test/api/gemini-token", { method: "POST", headers: { origin: "https://mira.test" } }), {}, {});
assert.equal(missingSecret.status, 503);

console.log("Secure Mira Worker artifact validated");
