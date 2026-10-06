// Existing Vite hosts serve the original avatar model/SDK assets locally.
// No runtime CDN, model service, upload proxy or credential is introduced.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const modelDigest = "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b";
const prefix = "profile-assets/";
export function profileAssets(hostModuleUrl: string) {
  // Production images install each host's peers, not this source package's
  // development dependencies. Resolve the SDK from that real Vite host.
  const sdk = dirname(createRequire(hostModuleUrl).resolve("@mediapipe/tasks-vision"));
  // This is a Node-side Vite plugin, not a browser URL asset expression.
  const model = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "src/react/profile/assets/selfie_segmenter.tflite"));
  if (createHash("sha256").update(model).digest("hex") !== modelDigest) throw new Error("Original avatar model digest mismatch");
  const assets = new Map<string, Buffer>([[`${prefix}selfie_segmenter.tflite`, model]]);
  for (const file of readdirSync(join(sdk, "wasm"))) {
    if (/^[a-z0-9_]+\.(?:js|wasm)$/.test(file)) assets.set(`${prefix}wasm/${file}`, readFileSync(join(sdk, "wasm", file)));
  }
  if (!assets.has(`${prefix}wasm/vision_wasm_internal.js`) || !assets.has(`${prefix}wasm/vision_wasm_internal.wasm`)) {
    throw new Error("Installed avatar SDK is missing its matching local WASM files");
  }
  let base = "/";
  return {
    name: "original-buzz-profile-assets",
    configResolved(config: { base: string }) { base = config.base; },
    generateBundle(this: { emitFile: (asset: { type: "asset"; fileName: string; source: Uint8Array }) => unknown }) {
      for (const [fileName, source] of assets) this.emitFile({ type: "asset", fileName, source });
    },
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: { setHeader: (key: string, value: string) => void; end: (bytes: Uint8Array) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0];
        const file = pathname?.startsWith(base) ? pathname.slice(base.length) : "";
        const bytes = assets.get(file);
        if (!bytes) return next();
        response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(bytes);
      });
    },
  };
}
