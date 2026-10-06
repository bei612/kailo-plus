import assert from "node:assert/strict";
import test from "node:test";
import { updateProfile } from "./tauriProfiles.ts";

const input = {
  idempotencyKey: "a1fd7de2-3b82-4877-a72a-1a18288a31b4",
  expectedPubkey: "a".repeat(64),
  expectedSignerPubkey: "a".repeat(64),
  expectedRelayUrl: "https://community.example",
  displayName: "Actual profile",
};

test("actual profile IPC consumer distinguishes canonical native rejection from lost replies", async () => {
  const original = globalThis.window;
  try {
    for (const failure of [new Error("IPC response lost"), "IPC unavailable", { code: "PROFILE_UPDATE_UNKNOWN" }]) {
      globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => { throw failure; } } };
      await assert.rejects(updateProfile(input), (error) => error.name === "TransportError");
    }
    globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => { throw { code: "PROFILE_UPDATE_REJECTED" }; } } };
    await assert.rejects(updateProfile(input), (error) => error.name === "TauriInvokeError");
    globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
      assert.equal(command, "update_profile");
      assert.deepEqual(args, input);
      return { pubkey: input.expectedPubkey, display_name: "Canonical", avatar_url: null,
        about: null, nip05_handle: null, owner_pubkey: null, has_profile_event: true };
    } } };
    assert.deepEqual(await updateProfile(input), { pubkey: input.expectedPubkey, displayName: "Canonical",
      avatarUrl: null, about: null, nip05Handle: null, ownerPubkey: null, hasProfileEvent: true });
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});
