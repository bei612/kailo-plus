// DD-125(2) on the native host: this device's own Relay refusal is mapped to the same
// structured PUBLISH_REJECTED restriction the BFF gives the Web (core collab-bridge
// moderation.rs::restriction_from_rejection), so the shared composer banner consumes one shape.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { PublishRestrictionKind } from "@client-kit/contracts";
import {
  publishRestrictionFromRelayFailure,
  RelayPublishNotSentError,
  RelayPublishRejectedError,
  RelayPublishUnknownError,
} from "./relayPublishOutcome.ts";

const UNTIL = 1_760_000_000;

test("a WebSocket OK false timeout becomes TIMED_OUT with the RFC3339 expiry", () => {
  const restriction = publishRestrictionFromRelayFailure(
    new RelayPublishRejectedError("e".repeat(64), `restricted: you are timed out until ${UNTIL}`),
  );
  assert.deepEqual(restriction, {
    kind: PublishRestrictionKind.TimedOut,
    until: new Date(UNTIL * 1000).toISOString(),
  });
});

test("the REST paths carry the same Relay text in their fixed prefixes", () => {
  for (const text of [
    `relay rejected event: restricted: you are timed out until ${UNTIL}`,
    `relay returned 403 Forbidden: restricted: you are timed out until ${UNTIL}`,
  ]) {
    assert.equal(publishRestrictionFromRelayFailure(new Error(text))?.kind, PublishRestrictionKind.TimedOut, text);
  }
  assert.deepEqual(
    publishRestrictionFromRelayFailure(new Error("relay rejected event: blocked: you are banned from this community")),
    { kind: PublishRestrictionKind.Banned },
  );
});

test("an unparseable expiry is still a timeout, without a countdown", () => {
  for (const reason of ["restricted: you are timed out until soon", "restricted: you are timed out until 99999999999999999"]) {
    assert.deepEqual(
      publishRestrictionFromRelayFailure(new RelayPublishRejectedError("e".repeat(64), reason)),
      { kind: PublishRestrictionKind.TimedOut },
      reason,
    );
  }
});

test("other rejections and every non-rejection leave the composer untouched", () => {
  assert.equal(publishRestrictionFromRelayFailure(new RelayPublishRejectedError("e".repeat(64), "invalid: bad tag")), undefined);
  assert.equal(publishRestrictionFromRelayFailure(new RelayPublishRejectedError("e".repeat(64), "rate-limited: retry in 3s")), undefined);
  // An unknown outcome is not a refusal even if some text matches.
  assert.equal(publishRestrictionFromRelayFailure(
    new RelayPublishUnknownError("e".repeat(64), `restricted: you are timed out until ${UNTIL}`)), undefined);
  assert.equal(publishRestrictionFromRelayFailure(new RelayPublishNotSentError("socket closed")), undefined);
  assert.equal(publishRestrictionFromRelayFailure(new Error("Channel is no longer available.")), undefined);
});

test("the mapped restriction drives the shared composer timeout store", async () => {
  // The shared moderation surface is a browser module; load it under a DOM like the app does.
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  const {
    clearTimeoutState,
    getTimeoutSnapshot,
    recordTimeoutFromRestriction,
  } = await import("@client-kit/platform/react/moderation");
  clearTimeoutState();
  const expires = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(recordTimeoutFromRestriction(publishRestrictionFromRelayFailure(
    new RelayPublishRejectedError("e".repeat(64), `restricted: you are timed out until ${expires}`))), true);
  assert.deepEqual(getTimeoutSnapshot(), { active: true, expiresAtMs: expires * 1000 });
  // A ban or another refusal is not a timeout and does not change the banner state.
  clearTimeoutState();
  assert.equal(recordTimeoutFromRestriction(publishRestrictionFromRelayFailure(
    new Error("relay rejected event: blocked: you are banned from this community"))), false);
  assert.equal(recordTimeoutFromRestriction(undefined), false);
  assert.deepEqual(getTimeoutSnapshot(), { active: false, expiresAtMs: null });
  dom.window.close();
});
