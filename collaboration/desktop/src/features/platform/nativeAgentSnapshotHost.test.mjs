// DD-131(5)(7): the native snapshot host saves through Rust, sends through the original native DM
// publish path and copies only a Relay media URL.
import assert from "node:assert/strict";
import { test } from "node:test";

const { createNativeAgentSnapshotHost, exportPackageContentPath } = await import("./nativeAgentSnapshotHost.ts");

const pkg = { assetId: "11111111-1111-4111-8111-111111111111", fileName: "scribe.agent.png", mediaType: "image/png", byteSize: 3 };
const file = { bytes: new Uint8Array([1, 2, 3]), fileName: "scribe.agent.png", mediaType: "image/png" };
const descriptor = { url: "https://relay.test/media/abc.png", sha256: "a".repeat(64), type: "image/png", size: 3, uploaded: 1, thumb: "https://relay.test/media/t.jpg" };

function deps(overrides = {}) {
  const calls = { invoke: [], upload: [], send: [], copy: [] };
  return {
    calls,
    deps: {
      invoke: async (command, args) => { calls.invoke.push([command, args]); return { status: 200, saved: true, body: null }; },
      onSessionEnded: () => {},
      getChannels: async () => ({ channels: [{ id: "dm-1", channelType: "dm" }, { id: "general", channelType: "stream" }] }),
      uploadMediaBytes: async (data, filename) => { calls.upload.push([data, filename]); return descriptor; },
      sendToChannel: async (channel, content, mediaTags) => { calls.send.push([channel, content, mediaTags]); },
      copyText: async (text) => { calls.copy.push(text); },
      ...overrides,
    },
  };
}

test("saves an ExportPackage through platform_api_save without moving bytes through the webview", async () => {
  const { calls, deps: host } = deps();
  assert.equal(await createNativeAgentSnapshotHost(host).saveExportPackage(pkg), true);
  assert.deepEqual(calls.invoke, [["platform_api_save", { path: exportPackageContentPath(pkg.assetId), suggestedFilename: "scribe.agent.png" }]]);
});

test("a refused package download is an error, not a saved file", async () => {
  const { deps: host } = deps({ invoke: async () => ({ status: 403, saved: false, body: { reason: "PERMISSION_DENIED" } }) });
  await assert.rejects(createNativeAgentSnapshotHost(host).saveExportPackage(pkg), /HTTP 403/);
});

test("sends the package as an imeta attachment in the prepared DM and never a thumbnail", async () => {
  const { calls, deps: host } = deps();
  await createNativeAgentSnapshotHost(host).sendAttachment({ id: "conversation-1", channelId: "dm-1" }, file, "Scribe", "key");
  assert.deepEqual(calls.upload, [[[1, 2, 3], "scribe.agent.png"]]);
  const [[channel, content, mediaTags]] = calls.send;
  assert.equal(channel.id, "dm-1");
  assert.equal(content, "\n[Scribe](https://relay.test/media/abc.png)");
  const imeta = mediaTags.find((tag) => tag[0] === "imeta");
  assert.ok(imeta.includes("filename scribe.agent.png"));
  assert.ok(!imeta.some((part) => part.startsWith("thumb ")));
});

test("refuses to send before the DM is synchronized and copies the Relay media URL as the link", async () => {
  const { calls, deps: host } = deps({ getChannels: async () => ({ channels: [] }) });
  const native = createNativeAgentSnapshotHost(host);
  await assert.rejects(native.sendAttachment({ id: "conversation-1", channelId: "dm-1" }, file, "Scribe", "key"));
  assert.equal(calls.send.length, 0);
  await native.copyLink(file, pkg);
  assert.deepEqual(calls.copy, ["https://relay.test/media/abc.png"]);
});
