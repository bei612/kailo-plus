import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert/strict";
import test from "node:test";
import type { AdapterPepCheckResponse, AdapterExecutionResponse } from "../src/generated/contracts.js";

test("adapter citations preserve typed sources and empty absence", () => {
  const sample: AdapterExecutionResponse[] = JSON.parse(readFileSync(new URL(
    "../../../../contracts/samples/adapter-citations.sample.json", import.meta.url), "utf8"));
  const actual: AdapterExecutionResponse[] = sample.map(row => ({
    execution: {...row.execution},
    resultJson: row.resultJson,
    contentReference: row.contentReference,
    contentReferences: row.contentReferences?.map(reference => ({
      resourceId: reference.resourceId,
      assetId: reference.assetId,
      nativeObjectRef: reference.nativeObjectRef,
      nativeRevision: reference.nativeRevision,
      displayName: reference.displayName,
      mediaType: reference.mediaType,
    })),
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(actual)), sample);
});

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
