import { createHash } from "node:crypto";
import { verifyEvent } from "nostr-tools/pure";

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const UNIT_PATTERN = /^[A-Za-z0-9@_.:-]+\.service$/;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function singleTag(event, name) {
  const values = event.tags
    .filter((tag) => Array.isArray(tag) && tag[0] === name)
    .map((tag) => tag[1]);
  if (values.length !== 1 || typeof values[0] !== "string" || !values[0]) {
    throw new HttpError(401, `NIP-98 requires exactly one ${name} tag`);
  }
  return values[0];
}

function decodeAuthorization(authorization) {
  if (typeof authorization !== "string" || !authorization.startsWith("Nostr ")) {
    throw new HttpError(401, "Missing NIP-98 authorization");
  }
  try {
    const encoded = authorization.slice("Nostr ".length).trim();
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new HttpError(401, "Invalid NIP-98 authorization");
  }
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseAgentUnits(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AGENT_UNITS_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AGENT_UNITS_JSON must be an object");
  }
  const units = new Map();
  for (const [pubkeyValue, unitValue] of Object.entries(parsed)) {
    const pubkey = pubkeyValue.toLowerCase();
    if (!PUBKEY_PATTERN.test(pubkey)) throw new Error(`Invalid agent pubkey: ${pubkeyValue}`);
    if (typeof unitValue !== "string" || !UNIT_PATTERN.test(unitValue)) {
      throw new Error(`Invalid systemd unit for ${pubkeyValue}`);
    }
    units.set(pubkey, unitValue);
  }
  if (!units.size) throw new Error("AGENT_UNITS_JSON must map at least one agent");
  return units;
}

export function parsePubkeySet(raw, label) {
  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length || values.some((value) => !PUBKEY_PATTERN.test(value))) {
    throw new Error(`${label} must contain one or more 64-character public keys`);
  }
  return new Set(values);
}

export function verifyNip98Request({
  authorization,
  method,
  url,
  body,
  allowedPubkeys,
  seenEventIds,
  nowSeconds = Math.floor(Date.now() / 1000),
  freshnessSeconds = 60,
}) {
  const event = decodeAuthorization(authorization);
  if (event.kind !== 27235 || !verifyEvent(event)) {
    throw new HttpError(401, "Invalid NIP-98 signature");
  }
  if (Math.abs(nowSeconds - event.created_at) > freshnessSeconds) {
    throw new HttpError(401, "Expired NIP-98 authorization");
  }
  const pubkey = String(event.pubkey).toLowerCase();
  if (!allowedPubkeys.has(pubkey)) throw new HttpError(403, "Owner authorization required");
  if (singleTag(event, "u") !== url) throw new HttpError(401, "NIP-98 URL mismatch");
  if (singleTag(event, "method").toUpperCase() !== method.toUpperCase()) {
    throw new HttpError(401, "NIP-98 method mismatch");
  }
  if (singleTag(event, "payload") !== sha256Hex(body)) {
    throw new HttpError(401, "NIP-98 payload mismatch");
  }
  singleTag(event, "nonce");
  if (seenEventIds.has(event.id)) throw new HttpError(409, "NIP-98 authorization already used");
  seenEventIds.set(event.id, event.created_at + freshnessSeconds);
  return pubkey;
}

export function pruneSeenEventIds(seenEventIds, nowSeconds = Math.floor(Date.now() / 1000)) {
  for (const [eventId, expiresAt] of seenEventIds) {
    if (expiresAt < nowSeconds) seenEventIds.delete(eventId);
  }
}

export async function readRequestBody(request, limit = 4096) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
