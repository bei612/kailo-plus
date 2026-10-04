// 四侧 round-trip 的 TypeScript 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。TypeScript 的类型在运行时被擦除，
// 因此这里额外断言样例的每个键都出现在生成接口的键集合里——否则「类型
// 对得上」会退化成「JSON 原样进出」这种无效验证。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, ok } from "node:assert/strict";
import test from "node:test";
import type { AutomationRunPage } from "../src/generated/contracts.js";
import type { AutomationVersionContent } from "../src/generated/contracts.js";

test("automation POST_MESSAGE round-trip preserves action and native schedule", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/automation-post-message.sample.json", import.meta.url), "utf8");
  const original: unknown = JSON.parse(raw);
  const typed: AutomationVersionContent = JSON.parse(raw);
  ok(typed.action.kind === "POST_MESSAGE");
  const reconstructed: AutomationVersionContent = {
    trigger: { kind: typed.trigger.kind, scheduleSpec: typed.trigger.scheduleSpec && {
      everySeconds: typed.trigger.scheduleSpec.everySeconds, offsetSeconds: typed.trigger.scheduleSpec.offsetSeconds,
      catchupWindowSeconds: typed.trigger.scheduleSpec.catchupWindowSeconds,
    } },
    action: { kind: typed.action.kind, template: typed.action.template }, resultTarget: typed.resultTarget,
  };
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});

test("automation run pages preserve UNKNOWN and empty page", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/automation-run-pages.sample.json", import.meta.url), "utf8");
  const original: unknown = JSON.parse(raw);
  const typed: AutomationRunPage[] = JSON.parse(raw);
  const reconstructed: AutomationRunPage[] = typed.map(page => ({
    automationResourceId: page.automationResourceId,
    runs: page.runs.map(run => ({
      task: run.task,
      progress: run.progress,
      usageEventIds: run.usageEventIds,
    })),
    nextCursor: page.nextCursor,
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});

import type { Canary, CapabilityConformanceVectors, WebPublishMessageRequest } from "../src/generated/contracts.js";

const samplePath = fileURLToPath(
  new URL("../../../../contracts/samples/canary.sample.json", import.meta.url),
);

test("capability vectors round-trip preserves steps and encoded values", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/capability-conformance-vectors.sample.json", import.meta.url), "utf8");
  const original: unknown = JSON.parse(raw);
  const typed: CapabilityConformanceVectors = JSON.parse(raw);
  deepStrictEqual(JSON.parse(JSON.stringify(typed)), original);
  // Explicit construction makes deletion/type drift of a nested field a compile
  // error; a JSON cast alone would not verify the generated TypeScript contract.
  const reconstructed: CapabilityConformanceVectors = {
    formatVersion: typed.formatVersion,
    cases: typed.cases.map(item => ({
      caseKey: item.caseKey,
      steps: item.steps.map(step => ({
        stepKey: step.stepKey, contractKey: step.contractKey,
        inputJson: step.inputJson, expectedOutputJson: step.expectedOutputJson,
      })),
    })),
  };
  deepStrictEqual(reconstructed, original);
});

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

for (const sample of ["web-publish-mention.sample.json", "web-publish-content-only.sample.json"]) {
  test(`WebPublishMessageRequest round-trip ${sample}`, () => {
    const raw = readFileSync(new URL(`../../../../contracts/samples/${sample}`, import.meta.url), "utf8");
    const original: unknown = JSON.parse(raw);
    const typed = JSON.parse(raw) as WebPublishMessageRequest;
    deepStrictEqual(JSON.parse(JSON.stringify(typed)), original);
    const src = readFileSync(new URL("../src/generated/contracts.ts", import.meta.url), "utf8");
    const iface = src.match(/export interface WebPublishMessageRequest \{([^}]+)\}/s)?.[1] ?? "";
    for (const key of Object.keys(typed)) ok(iface.includes(key), `request field ${key}`);
    const attachment = src.match(/export interface WebMessageAttachment \{([^}]+)\}/s)?.[1] ?? "";
    for (const item of typed.attachments ?? []) {
      for (const key of Object.keys(item)) ok(attachment.includes(key), `attachment field ${key}`);
    }
  });
}
