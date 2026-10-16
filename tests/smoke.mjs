import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, js, worker, workflow, hosting] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/runtime.js", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
  readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
]);

const requiredIds = [
  "startButton",
  "settingsDialog",
  "consentDialog",
  "userVideo",
  "expressionCue",
  "toneCue",
  "postureCue",
  "messageForm",
];

for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);

assert.match(html, /Mira offers companionship, not medical advice/, "safety boundary must be visible");
assert.match(html, /permanent key stays on the server/, "secure server-side key messaging is missing");
assert.match(html, /Gemini Live status/, "the settings panel must present connection status, not setup");
assert.match(html, /app\.js\?v=6/, "the client bundle needs a release cache-buster");
assert.match(css, /@media \(max-width: 620px\)/, "mobile layout is required");
assert.match(css, /prefers-reduced-motion/, "reduced motion support is required");
assert.match(js, /gemini-3\.8-live/, "Gemini Live model is not configured");
assert.match(js, /FaceLandmarker/, "local facial-cue model is not configured");
assert.match(js, /PoseLandmarker/, "local posture model is not configured");
assert.match(js, /audio\/pcm/, "raw audio streaming is not configured");
assert.match(js, /\/api\/gemini-token/, "ephemeral-token endpoint is not configured");
assert.match(js, /dhairya1611\.github\.io/, "the GitHub Pages frontend must use the secure token backend");
assert.match(worker, /GITHUB_PAGES_ORIGIN = "https:\/\/dhairya1611\.github\.io"/, "the token backend must allow only the owner's Pages origin");
assert.match(worker, /access-control-allow-origin/, "the GitHub Pages token response must include CORS headers");
assert.match(workflow, /actions\/deploy-pages@v4/, "the GitHub Pages deployment workflow is missing");
assert.match(js, /void connectGemini\(\{ automatic: true \}\)/, "Gemini must connect automatically on page load");
assert.match(js, /updateUserTranscription\(state\.userTranscript\.trim\(\)\)/, "spoken words must render as live user transcription");
assert.match(js, /before: state\.transcriptNode/, "the user transcript must stay before Mira's streamed reply");
assert.doesNotMatch(js, /apiKeyInput|Paste your key/, "the public client must not ask visitors for a permanent key");
assert.doesNotMatch(js, /localStorage|sessionStorage/, "API keys and transcripts must not be persisted in browser storage");

const manifest = JSON.parse(hosting);
assert.ok(manifest.project_id, "hosting project id is missing");
assert.equal(manifest.static, undefined, "Mira must deploy as a Worker so the Gemini key stays server-side");

console.log("Mira smoke checks passed");
