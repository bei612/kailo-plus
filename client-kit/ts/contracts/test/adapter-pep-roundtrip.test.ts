import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert/strict";
import test from "node:test";
import type { AdapterPepCheckResponse } from "../src/generated/contracts.js";

test("adapter PEP preserves native resource and legacy absence", () => {
  const sample: AdapterPepCheckResponse[] = JSON.parse(readFileSync(new URL(
    "../../../../contracts/samples/adapter-pep-resource.sample.json", import.meta.url), "utf8"));
  const actual: AdapterPepCheckResponse[] = sample.map(row => ({
    actionExecutionId: row.actionExecutionId,
    operationId: row.operationId,
    authorizationMinZedToken: row.authorizationMinZedToken,
    targetResource: row.targetResource && {
      resourceId: row.targetResource.resourceId,
      nativeType: row.targetResource.nativeType,
      nativeRef: row.targetResource.nativeRef,
      nativeInstanceRef: row.targetResource.nativeInstanceRef,
      nativeScopeRef: row.targetResource.nativeScopeRef,
    },
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(actual)), sample);
});
