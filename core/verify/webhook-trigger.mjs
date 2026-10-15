// DD-116 WEBHOOK trigger acceptance: signed deliveries against a deployed
// public listener. Node built-ins only (crypto/fetch); no dependency install.
//
//   WEBHOOK_URL=https://<public base>/hooks/<automation_resource_id> \
//   WEBHOOK_SECRET=whsec_...            # shown once at enable/rotate; never printed
//   [WEBHOOK_OLD_SECRET=whsec_...]      # the key replaced by a rotation, if testing rotation
//   node core/verify/webhook-trigger.mjs [--skip-run]
//
// Signature (Standard Webhooks): webhook-signature = "v1," + base64(HMAC-SHA256(
// key = base64-decoded part after "whsec_", "<webhook-id>.<webhook-timestamp>.<raw body>")).
// --skip-run omits the one delivery that admits a real automation.run.
// Exit status is non-zero when any expectation fails. The printed delivery IDs
// are for the read-only database check (catalog.automation_webhook_delivery,
// catalog.agent_invocation with source_kind='WEBHOOK').

import { createHmac, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values: flags } = parseArgs({ options: { "skip-run": { type: "boolean", default: false } } });

const url = process.env.WEBHOOK_URL;
const secret = process.env.WEBHOOK_SECRET;
if (!url || !/\/hooks\/[0-9a-fA-F-]{36}$/.test(new URL(url).pathname)) {
  throw new Error("WEBHOOK_URL must be <public base>/hooks/<automation_resource_id>");
}

function key(value, name) {
  const match = /^whsec_([A-Za-z0-9+/]{43}=)$/.exec(value ?? "");
  if (!match) throw new Error(`${name} must be the whsec_ value shown once by Kailo`);
  return Buffer.from(match[1], "base64");
}

const current = key(secret, "WEBHOOK_SECRET");
const previous = process.env.WEBHOOK_OLD_SECRET ? key(process.env.WEBHOOK_OLD_SECRET, "WEBHOOK_OLD_SECRET") : null;

export function sign(signingKey, id, timestamp, body) {
  const digest = createHmac("sha256", signingKey).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${digest}`;
}

const now = () => Math.floor(Date.now() / 1000);

async function deliver({ id = `kailo-accept-${randomUUID()}`, body = JSON.stringify({ service: "acceptance" }),
  signingKey = current, timestamp = now(), headers, method = "POST" } = {}) {
  const signed = headers ?? {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": sign(signingKey, id, timestamp, body),
  };
  const response = await fetch(url, { method, headers: signed, body: method === "GET" ? undefined : body });
  return { id, status: response.status };
}

const results = [];
async function expect(name, want, run) {
  const { id, status } = await run();
  results.push({ name, want, status, ok: status === want, deliveryId: id });
}

const shared = `kailo-accept-${randomUUID()}`;
const sharedBody = JSON.stringify({ service: "acceptance", text: "Kailo webhook acceptance" });

if (!flags["skip-run"]) {
  await expect("signed delivery is accepted and admitted", 202, () => deliver({ id: shared, body: sharedBody }));
  await expect("same delivery ID and body is not run again", 202, () => deliver({ id: shared, body: sharedBody }));
  await expect("same delivery ID with another body is refused", 409,
    () => deliver({ id: shared, body: JSON.stringify({ service: "tampered" }) }));
}
await expect("signature with another key is refused", 401, () => deliver({ signingKey: Buffer.alloc(32, 7) }));
await expect("timestamp older than five minutes is refused", 401, () => deliver({ timestamp: now() - 360 }));
await expect("timestamp more than five minutes ahead is refused", 401, () => deliver({ timestamp: now() + 360 }));
await expect("missing signature headers are refused", 401,
  () => deliver({ headers: { "content-type": "application/json" } }));
await expect("signed body that is not JSON is refused", 400, () => deliver({ body: "not json" }));
await expect("GET is not a delivery", 404, () => deliver({ method: "GET", headers: {} }));
if (previous) {
  await expect("the key replaced by rotation no longer verifies", 401, () => deliver({ signingKey: previous }));
}

for (const row of results) {
  console.log(`${row.ok ? "PASS" : "FAIL"} ${row.name}: want ${row.want}, got ${row.status}`
    + (row.deliveryId && row.name.startsWith("signed delivery") ? ` (webhook-id ${row.deliveryId})` : ""));
}
console.log(JSON.stringify({
  url,
  admittedDeliveryId: flags["skip-run"] ? null : shared,
  passed: results.filter((row) => row.ok).length,
  failed: results.filter((row) => !row.ok).length,
}));
if (results.some((row) => !row.ok)) process.exitCode = 1;
