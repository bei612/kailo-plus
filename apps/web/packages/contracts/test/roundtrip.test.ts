// 四侧 round-trip 的 TypeScript 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。TypeScript 的类型在运行时被擦除，
// 因此这里额外断言样例的每个键都出现在生成接口的键集合里——否则「类型
// 对得上」会退化成「JSON 原样进出」这种无效验证。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, ok } from "node:assert/strict";
import test from "node:test";

import type { Canary } from "../src/generated/contracts.js";

const samplePath = fileURLToPath(
  new URL("../../../../contracts/samples/canary.sample.json", import.meta.url),
);

test("canary round-trip 保留每个字段", () => {
  const raw = readFileSync(samplePath, "utf8");
  const original: unknown = JSON.parse(raw);

  const typed = JSON.parse(raw) as Canary;
  const back: unknown = JSON.parse(JSON.stringify(typed));

  deepStrictEqual(back, original, "round-trip 后与样例不等");

  // 生成接口必须覆盖样例的顶层键；缺任一个说明 schema 与生成物脱节
  const src = readFileSync(
    fileURLToPath(new URL("../src/generated/contracts.ts", import.meta.url)),
    "utf8",
  );
  const iface = src.slice(src.indexOf("export interface Canary"));
  for (const key of Object.keys(original as Record<string, unknown>)) {
    ok(iface.includes(key), `生成的 Canary 接口缺少字段 ${key}`);
  }
});
