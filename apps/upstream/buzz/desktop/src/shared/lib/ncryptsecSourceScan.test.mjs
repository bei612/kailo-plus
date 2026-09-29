import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Structural tripwire: the device key never leaves this machine (Kailo DD-79),
// so the frontend has no NIP-49 backup, export or import path at all. Any file
// in `desktop/src` touching `ncryptsec` is a regression toward an egress path
// for the device key and must be reviewed.
//
// Mirror of the Rust-side scan in
// `src-tauri/src/egress_guard_tests.rs`.

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const ALLOWLIST = [
  // this scan:
  "shared/lib/ncryptsecSourceScan.test.mjs",
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

test("ncryptsec handling is confined to allowlisted frontend files", () => {
  const violations = [];
  for (const file of walk(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).replaceAll("\\", "/");
    if (ALLOWLIST.includes(rel)) continue;
    const content = fs.readFileSync(file, "utf8");
    if (content.toLowerCase().includes("ncryptsec")) {
      violations.push(rel);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `NIP-49 material outside allowlisted files — wire it through the ` +
      `identity layer (and its egress-guarded Rust commands) instead:\n` +
      violations.join("\n"),
  );
});
