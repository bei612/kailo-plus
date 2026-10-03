import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// 执行真实模块，仅替换它的 IPC、缓存与 Relay 边界；不复制取消/串行化实现。
function load({
  apply = async () => {},
  identity = async () => ({ pubkey: "device" }),
} = {}) {
  const calls = [];
  const dependencies = new Proxy(
    {
      applyCommunity: async (url) => {
        calls.push(["apply", url]);
        await apply(url);
      },
      getIdentity: identity,
      initDraftStore: (...args) => calls.push(["draft", ...args]),
      relayClient: { disconnect: () => calls.push(["disconnect"]) },
    },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  const source = readFileSync(
    new URL("./connectCommunity.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  new Function("require", "exports", compiled.outputText)(
    () => dependencies,
    exports,
  );
  return { ...exports, calls };
}

test("cancelled native apply finishes before a later community is installed", async () => {
  const entered = deferred();
  const release = deferred();
  let nativeUrl;
  const host = load({
    apply: async (url) => {
      if (url === "old") {
        entered.resolve();
        await release.promise;
      }
      nativeUrl = url;
    },
  });
  const old = new AbortController();
  const current = new AbortController();
  const first = host.connectCommunity({ relayUrl: "old" }, old.signal);
  const rejected = assert.rejects(first, { name: "AbortError" });
  await entered.promise;
  old.abort();
  const second = host.connectCommunity({ relayUrl: "new" }, current.signal);
  await Promise.resolve();
  assert.deepEqual(
    host.calls.filter(([kind]) => kind === "apply"),
    [["apply", "old"]],
  );
  release.resolve();
  await rejected;
  await second;
  assert.equal(nativeUrl, "new");
  assert.deepEqual(
    host.calls.filter(([kind]) => kind === "draft"),
    [["draft", "device", "new"]],
  );
});

test("logout while identity IPC is pending cannot reinitialize drafts", async () => {
  const entered = deferred();
  const identity = deferred();
  const host = load({
    identity: () => {
      entered.resolve();
      return identity.promise;
    },
  });
  const controller = new AbortController();
  const connecting = host.connectCommunity(
    { relayUrl: "old" },
    controller.signal,
  );
  const rejected = assert.rejects(connecting, { name: "AbortError" });
  await entered.promise;
  controller.abort();
  identity.resolve({ pubkey: "old-device" });
  await rejected;
  assert.equal(host.calls.filter(([kind]) => kind === "draft").length, 0);
  assert.equal(host.calls.filter(([kind]) => kind === "disconnect").length, 1);
});

test("already cancelled flow never invokes native apply; ready abort disconnects", async () => {
  const host = load();
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    host.connectCommunity({ relayUrl: "old" }, cancelled.signal),
    { name: "AbortError" },
  );
  assert.deepEqual(host.calls, []);
  const ready = new AbortController();
  await host.connectCommunity({ relayUrl: "current" }, ready.signal);
  ready.abort();
  assert.deepEqual(host.calls.at(-1), ["disconnect"]);
});
