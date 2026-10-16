import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimePath = resolve(projectRoot, "worker/runtime.js");
const outputRoot = resolve(projectRoot, "dist");

const assets = {
  "__MIRA_HTML_B64__": resolve(projectRoot, "public/index.html"),
  "__MIRA_CSS_B64__": resolve(projectRoot, "public/styles.css"),
  "__MIRA_JS_B64__": resolve(projectRoot, "public/app.js"),
  "__MIRA_AVATAR_B64__": resolve(projectRoot, "public/assets/mira-avatar.png"),
};

let worker = await readFile(runtimePath, "utf8");
for (const [placeholder, path] of Object.entries(assets)) {
  const contents = await readFile(path);
  worker = worker.replace(placeholder, contents.toString("base64"));
}

if (worker.includes("__MIRA_")) throw new Error("A Worker asset placeholder was not replaced.");

await mkdir(resolve(outputRoot, "server"), { recursive: true });
await mkdir(resolve(outputRoot, ".openai"), { recursive: true });
await writeFile(resolve(outputRoot, "server/index.js"), worker);
await writeFile(resolve(outputRoot, ".openai/hosting.json"), await readFile(resolve(projectRoot, ".openai/hosting.json")));

console.log(`Built secure Mira Worker at ${outputRoot}`);
