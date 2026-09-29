import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import {
  HttpError,
  parseAgentUnits,
  parsePubkeySet,
  pruneSeenEventIds,
  readRequestBody,
  verifyNip98Request,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const listenHost = process.env.LISTEN_HOST || "127.0.0.1";
const listenPort = Number.parseInt(process.env.LISTEN_PORT || "8095", 10);
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const allowedOwners = parsePubkeySet(process.env.OWNER_PUBKEYS || "", "OWNER_PUBKEYS");
const trustedProxies = new Set(
  (process.env.TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const agentUnits = parseAgentUnits(process.env.AGENT_UNITS_JSON || "{}");
const seenEventIds = new Map();

if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
  throw new Error("LISTEN_PORT must be a valid TCP port");
}
if (!publicBaseUrl.startsWith("https://") && !publicBaseUrl.startsWith("http://localhost")) {
  throw new Error("PUBLIC_BASE_URL must use HTTPS");
}

function remoteAddress(request) {
  return (request.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Security-Policy": "default-src 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function isActive(unit) {
  try {
    await execFileAsync("/usr/bin/systemctl", ["is-active", "--quiet", unit], {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

async function startAgent(unit) {
  const wasActive = await isActive(unit);
  await execFileAsync("/usr/bin/systemctl", [wasActive ? "restart" : "start", unit], {
    timeout: 15000,
  });
  if (!(await isActive(unit))) throw new HttpError(502, "Agent service did not become active");
  return wasActive ? "restarted" : "started";
}

async function handle(request, response) {
  const path = new URL(request.url || "/", "http://localhost").pathname;
  if (trustedProxies.size && !trustedProxies.has(remoteAddress(request))) {
    throw new HttpError(403, "Untrusted proxy");
  }
  if (request.method === "GET" && path === "/healthz") {
    json(response, 200, { status: "ok" });
    return;
  }
  if (request.method !== "POST" || path !== "/start") {
    throw new HttpError(404, "Not found");
  }

  const body = await readRequestBody(request);
  pruneSeenEventIds(seenEventIds);
  verifyNip98Request({
    authorization: request.headers.authorization,
    method: "POST",
    url: `${publicBaseUrl}/start`,
    body,
    allowedPubkeys: allowedOwners,
    seenEventIds,
  });

  let input;
  try {
    input = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  const pubkey = typeof input?.pubkey === "string" ? input.pubkey.toLowerCase() : "";
  const unit = agentUnits.get(pubkey);
  if (!unit) throw new HttpError(404, "Agent is not startable on this host");

  const action = await startAgent(unit);
  json(response, 202, { status: "accepted", action, pubkey });
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : "Agent start failed";
    if (status >= 500) console.error("Agent control request failed", error);
    if (!response.headersSent) json(response, status, { error: message });
    else response.end();
  });
});

server.listen(listenPort, listenHost, () => {
  console.log(`Buzz agent control listening on ${listenHost}:${listenPort}`);
});
