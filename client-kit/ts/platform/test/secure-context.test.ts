// The deployed Web origin is plain HTTP, not a secure context, so crypto.randomUUID does not exist
// there; calling it during render took the whole Web app down. Shipped shared and Web sources use
// governance.newIdempotencyKey (crypto.getRandomValues) instead.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx|mts|mjs)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

it("no shipped shared or Web source calls crypto.randomUUID", () => {
  const roots = [resolve(import.meta.dirname, "../src"), resolve(import.meta.dirname, "../../../../web-client/web/src")];
  const offenders = roots.flatMap(sources).filter((path) => /\brandomUUID\s*\(/.test(readFileSync(path, "utf8")));
  expect(offenders).toEqual([]);
});
