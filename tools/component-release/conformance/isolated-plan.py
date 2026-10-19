#!/usr/bin/env python3
"""Isolated bind plan of one conformance candidate (07 §8A, DD-76/102).

Stage 2 -> 3 of tools/component-release/conformance-run.sh (file-storage).
component-bind.mjs --plan-only derives the plan from a PRODUCTION login: its
tenant, actor and binding exist in production Core, so Core's
component_release.rs authorize_probe refuses every suite probe signed for them
(ScopeGuardFailed: "these identities only exist in the isolated environment").
This writes the same plan shape (deploy/components/adapter-delivery.py
load_plan/config/reader consume it unchanged) from fresh simulated UUIDs that
exist nowhere else: tenant, binding, binding service principal, permitted and
denied actor principals, and one result exposure policy. Nothing here logs in,
contacts Core, OpenBao or the native instance, or reads a secret.

  python3 -I isolated-plan.py --release-dir <render.mjs output>
      --native-facts /abs/native-facts.json (stage-2 seed output, owner-only)
      --native-page-url <url in the release nativePageOrigins>
      --native-instance-ref <ref> --kv-mount <isolated OpenBao KV mount segment>
      [--adapter-service-ref file-storage-adapter] [--isolation-mode DEDICATED_INSTANCE]
      [--client-id <id>] [--model-call-mode <mode>] [--binding-generation 1]
      [--binding-action-version 1] [--actor-native-user <uuid>]
      --plan-out /abs/isolated-plan.json --context-out /abs/isolated-context.json

Outputs are create-only, mode 0600 (fresh identities differ on every call, so
an existing file is never reused):

  plan     component-bind.mjs plan fields; nativeScopeRef = the seeded
           nativeWorkspaceId; SecretRef locators under the isolated OpenBao's
           tenants/<simulated tenant>/<kv mount>/application-binding/<binding>/.
  context  the same identities for the other consumers, keyed by destination:
           principals, bindingManagement   -> observe.json (as is)
           resultExposurePolicy            -> observe.json execution.* and
                                              vectorContexts.default
           providerBinding                 -> conformance-provider bindingFile
                                              (+ serviceClientSecretFile)
           nativeActionSets                -> adapter-delivery.py --set NAME=VALUE
           actors (with --actor-native-user) -> adapter-delivery.py --set-json actors
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.parse
import uuid

SEGMENT = re.compile(r"[A-Za-z0-9_-]+")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# isolated-openbao.sh accepts only this parent namespace for binding SecretRefs.
TENANT_PARENT = "tenants"


class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def canonical(value):
    # tools/component-release/render.mjs canonical(): sorted keys, no spaces.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def fresh():
    return str(uuid.uuid4())


def owner_only_json(path, name):
    require(os.path.isabs(path), f"{name}: absolute path required")
    info = os.lstat(path)
    require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, f"{name}: owner-only regular file required")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def rendered_manifest(release_dir):
    # Same checks as flow/lib.mjs renderedRelease().
    registration = json.loads((Path(release_dir) / "registration.json").read_text(encoding="utf-8"))
    require(sorted(registration) == ["bindingConfigSchemaJson", "manifestJson", "packageJson"],
            "--release-dir is not a render.mjs output")
    manifest = json.loads(registration["manifestJson"])
    require(UUID.fullmatch(manifest.get("id", "")) is not None and "{{" not in json.dumps(manifest),
            "--release-dir still has template placeholders")
    require(re.fullmatch(r"[0-9a-f]{64}", manifest.get("adapterBuildRef", "")) is not None,
            "manifest adapterBuildRef must be the 64-hex adapter digest")
    return manifest


def page_url(value, manifest):
    parts = urllib.parse.urlsplit(value)
    require(parts.scheme in ("http", "https") and parts.hostname and parts.username is None and parts.password is None,
            "--native-page-url must be http(s) without credentials")
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    port = parts.port
    origin = f"{parts.scheme}://{host}" + (f":{port}" if port and port != {"http": 80, "https": 443}[parts.scheme] else "")
    origins = (manifest.get("frontendDelivery") or {}).get("nativePageOrigins") or []
    require(origin in origins, f"native page origin {origin} is not in the release nativePageOrigins")
    return value


def create_only(path, document):
    require(os.path.isabs(path), f"{path}: absolute output path required")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--release-dir", required=True)
    parser.add_argument("--native-facts", required=True)
    parser.add_argument("--native-page-url", required=True)
    parser.add_argument("--native-instance-ref", required=True)
    parser.add_argument("--kv-mount", required=True)
    parser.add_argument("--adapter-service-ref", default="file-storage-adapter")
    parser.add_argument("--isolation-mode", default="DEDICATED_INSTANCE")
    parser.add_argument("--client-id")
    parser.add_argument("--model-call-mode")
    parser.add_argument("--binding-generation", type=int, default=1)
    parser.add_argument("--binding-action-version", type=int, default=1,
                        help="ActionDefinition version of application_binding.create (observe.json bindingManagement)")
    parser.add_argument("--actor-native-user", help="UUID of the isolated native user linked to the permitted actor")
    parser.add_argument("--plan-out", required=True)
    parser.add_argument("--context-out", required=True)
    args = parser.parse_args()
    try:
        manifest = rendered_manifest(args.release_dir)
        facts = owner_only_json(args.native_facts, "--native-facts")
        require(isinstance(facts, dict) and facts.get("component") == "file-storage", "--native-facts is not a Cells seed output")
        scope, root = facts.get("nativeWorkspaceId"), facts.get("nativeRootRef")
        require(isinstance(scope, str) and scope.strip() == scope and scope, "native facts nativeWorkspaceId required")
        require(isinstance(root, str) and UUID.fullmatch(root) is not None, "native facts nativeRootRef must be a UUID")
        require(args.native_instance_ref.strip() == args.native_instance_ref and args.native_instance_ref, "--native-instance-ref required")
        require(SEGMENT.fullmatch(args.kv_mount) is not None, "--kv-mount must be one KV mount segment")
        require(args.binding_generation > 0 and args.binding_action_version > 0, "generation and action version must be positive")
        require(args.actor_native_user is None or UUID.fullmatch(args.actor_native_user) is not None, "--actor-native-user must be a UUID")
        for out in (args.plan_out, args.context_out):
            require(os.path.isabs(out) and not os.path.lexists(out), f"{out}: new absolute output path required")
        normalized = {"nativePageUrl": page_url(args.native_page_url, manifest)}
        modes = manifest.get("allowedModelCallModes") or ["NONE"]
        mode = args.model_call_mode or modes[0]
        require(mode in modes, f"modelCallMode {mode} not allowed by the release")
        audience = manifest["executionConnector"]["actionTokenAudience"]

        tenant, binding, service = fresh(), fresh(), fresh()
        actor, denied, policy = fresh(), fresh(), fresh()
        client = args.client_id or f"{args.adapter_service_ref}-{binding[:8]}"
        require(SEGMENT.fullmatch(client) is not None, "--client-id must be one IdP client id segment")
        normalized["client_id"] = client
        plan = {
            "tenantId": tenant,
            "componentReleaseId": manifest["id"],
            "componentTypeKey": manifest["componentTypeKey"],
            "artifactDigest": manifest["adapterBuildRef"],
            "bindingId": binding,
            "bindingVersion": 1,
            "servicePrincipalId": service,
            "adapterServiceRef": args.adapter_service_ref,
            "nativeInstanceRef": args.native_instance_ref,
            "nativeScopeRef": scope,
            "isolationMode": args.isolation_mode,
            "capabilityCategories": [{"category": item["categoryKey"], "version": item["contractVersion"]} for item in manifest["implements"]],
            "normalizedConfig": normalized,
            "configDigest": digest(normalized),
            "clientId": client,
            "modelCallMode": mode,
            "retainOnTenantDelete": any(d.get("tenantDelete") == "RETAIN_ON_TENANT_DELETE" for d in manifest.get("capabilityDeclarations", [])),
            "secretRefs": [{"secretKey": s["secretKey"],
                            "locator": f"{TENANT_PARENT}/{tenant}/{args.kv_mount}/application-binding/{binding}/{s['secretKey']}",
                            "version": 1, "audience": audience} for s in manifest["secretSchema"]],
            "actionVersions": [{"actionKey": a["actionKey"], "actionVersion": a["version"]} for a in manifest["actionDefinitions"]],
        }
        require(plan["secretRefs"] and all(SEGMENT.fullmatch(r["secretKey"]) for r in plan["secretRefs"]), "release secretSchema keys invalid")
        result_policy = {"resultExposurePolicyId": policy, "resultExposurePolicyVersion": 1}
        context = {
            "principals": {"tenantId": tenant, "actorPrincipalId": actor, "deniedActorPrincipalId": denied,
                           "authorizationMinZedToken": f"conformance-simulated-{fresh()}"},
            "bindingManagement": {"bindingId": binding, "actionDefinitionVersion": args.binding_action_version},
            "resultExposurePolicy": result_policy,
            "providerBinding": {"bindingId": binding, "tenantId": tenant, "bindingGeneration": args.binding_generation,
                                "nativeInstanceRef": args.native_instance_ref, "nativeScopeRef": scope,
                                "serviceClientId": client, "artifactDigest": manifest["adapterBuildRef"]},
            "nativeActionSets": {"nativeRootRef": root, "bindingGeneration": str(args.binding_generation),
                                 **{f"{action}ResultExposurePolicyId": policy for action in ("write", "share", "delete")},
                                 **{f"{action}ResultExposurePolicyVersion": "1" for action in ("write", "share", "delete")}},
        }
        if args.actor_native_user:
            context["actors"] = [{"principalId": actor, "kind": "HUMAN", "userUuid": args.actor_native_user}]
        create_only(args.plan_out, plan)
        create_only(args.context_out, context)
    except (Refused, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error) if isinstance(error, Refused) else "isolated plan refused; inspect the release dir and native facts", file=sys.stderr)
        sys.exit(78)
    print(json.dumps({"planOut": args.plan_out, "contextOut": args.context_out, "tenantId": tenant, "bindingId": binding,
                      "nativeRootRef": root, "simulated": True}))


if __name__ == "__main__":
    main()
