import assert from "node:assert/strict";
import test from "node:test";

const { applicationRouteSearch } = await import("./applicationRouteSearch.ts");

// DD-138(4)(5), 07 §4.8.3/§4.8.4: the application route keeps only a well-formed relative path.
test("application route keeps a well-formed native page path and the workspace", () => {
  assert.deepEqual(applicationRouteSearch({ workspaceId: "ws-1", path: "/files/a?view=1#top" }),
    { workspaceId: "ws-1", path: "/files/a?view=1#top" });
  assert.deepEqual(applicationRouteSearch({}), { workspaceId: undefined, path: undefined });
});

test("application route drops malformed native page paths", () => {
  for (const path of ["//evil.test/x", "files/a", "/a\\b", "/a b", "/a\u0000", `/${"a".repeat(1024)}`, 7, {}, ""])
    assert.equal(applicationRouteSearch({ path }).path, undefined, String(path));
  assert.equal(applicationRouteSearch({ workspaceId: "  " }).workspaceId, undefined);
});
