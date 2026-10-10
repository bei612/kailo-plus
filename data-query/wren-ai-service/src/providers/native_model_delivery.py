"""Read-back of actual native providers into the existing adapter directory."""

import copy
import hashlib
import hmac
import json
import os
import fcntl
from pathlib import Path
import re
import stat
import tempfile
from urllib.parse import urlsplit
from uuid import UUID

from src.providers import transform


class ModelDeliveryUnavailable(Exception):
    def __init__(self):
        super().__init__("Native model delivery unavailable")


def require(condition):
    if not condition:
        raise ModelDeliveryUnavailable()


def canonical_uuid(value):
    return isinstance(value, str) and str(UUID(value)) == value


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def private_path(raw):
    require(isinstance(raw, str) and os.path.isabs(raw))
    path = Path(raw)
    require(str(path) == raw and path.resolve(strict=True) == path)
    return path


def read_private(raw):
    path = private_path(raw)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077)
        return json.load(stream, object_pairs_hook=unique_object)


class NativeModelDelivery:
    """One startup observation, not an account, model or authorization writer."""

    def __init__(self, settings):
        self.paths = [settings.model_delivery_input_file, settings.model_credential_file,
                      settings.model_adapter_directory_file]
        self.output = settings.model_delivery_output_file
        self.enabled = any(value is not None for value in [*self.paths, self.output])
        self.published = None
        self.directory_fd = None

    def __enter__(self):
        if not self.enabled:
            return self
        try:
            require(all(isinstance(value, str) and value for value in [*self.paths, self.output]))
            require(len(set([*self.paths, self.output])) == 4)
            output = Path(self.output)
            require(output.is_absolute() and str(output) == self.output)
            parent = private_path(str(output.parent))
            self.directory_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(self.directory_fd)
            require(not info.st_mode & 0o077)
            # Same native output directory has only one active lifespan writer.
            fcntl.flock(self.directory_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.documents = [read_private(path) for path in self.paths]
            self.source_documents = copy.deepcopy(self.documents)
            self._validate()
            # A previous startup receipt is never a claim about this startup.
            # Only this explicitly configured owner-only output is removed.
            try:
                prior = os.stat(output.name, dir_fd=self.directory_fd, follow_symlinks=False)
                require(stat.S_ISREG(prior.st_mode) and not prior.st_mode & 0o077)
                require(all((os.stat(path).st_dev, os.stat(path).st_ino)
                            != (prior.st_dev, prior.st_ino) for path in self.paths))
                previous = read_private(self.output)
                adapters = [entry for entry in previous["adapters"]
                            if entry["adapterServiceRef"] == self.adapter["adapterServiceRef"]
                            and entry["nativeInstanceRef"] == self.adapter["nativeInstanceRef"]]
                require(len(adapters) == 1)
                projection = self.documents[0]["projection"]
                receipts = [receipt for receipt in adapters[0].get("modelCredentialDeliveries", [])
                            if receipt["bindingId"] == projection["bindingId"]]
                require(receipts and all(
                    receipt["nativeScopeRef"] == projection["nativeScopeRef"]
                    and receipt["servicePrincipalId"] == projection["gatewayPrincipalId"]
                    and type(receipt["generation"]) is int
                    and 0 < receipt["generation"] <= projection["generation"]
                    and (receipt["generation"] != projection["generation"]
                         or receipt["configDigest"] == projection["configDigest"])
                    for receipt in receipts))
                os.unlink(output.name, dir_fd=self.directory_fd)
                os.fsync(self.directory_fd)
            except FileNotFoundError:
                pass
            return self
        except Exception:
            self._close()
            raise ModelDeliveryUnavailable() from None

    def _validate(self):
        delivery, material, directory = self.documents
        require(isinstance(delivery, dict) and set(delivery) == {"projection", "models"})
        projection = delivery["projection"]
        require(isinstance(material, dict) and set(material) == {"delivery", "requestId", "version", "value"})
        require(material["delivery"] == delivery and canonical_uuid(material["requestId"]))
        require(isinstance(material["value"], str) and material["value"]
                and not any(c.isspace() or c == "\x00" for c in material["value"]))
        for key in ["bindingId", "tenantId", "workspaceId", "gatewayPrincipalId"]:
            require(canonical_uuid(projection[key]))
        require(type(projection["generation"]) is int and projection["generation"] > 0)
        require(re.fullmatch(r"[0-9a-f]{64}", projection["configDigest"]))
        require(re.fullmatch(r"[1-9][0-9]*", projection["nativeScopeRef"]))
        reference = projection["serviceSecretRef"]
        require(set(reference) == {"locator", "version", "audience"})
        require(type(reference["version"]) is int and reference["version"] > 0
                and material["version"] == reference["version"])
        require(reference["locator"] == projection["secretRef"]["locator"]
                and reference["version"] == projection["secretRef"]["version"]
                and reference["audience"] != projection["secretRef"]["audience"])
        require(projection["secretReader"]["servicePrincipalId"] == projection["gatewayPrincipalId"]
                and projection["secretReader"]["audience"] == reference["audience"])
        require(isinstance(directory, dict) and isinstance(directory.get("adapters"), list))
        matches = []
        for adapter in directory["adapters"]:
            for binding in adapter.get("bindings", []):
                if binding["bindingId"] == projection["bindingId"]:
                    matches.append((adapter, binding))
        require(len(matches) == 1)
        self.adapter, binding = matches[0]
        require(binding["isolationMode"] == "DEDICATED_INSTANCE")
        for key in ["tenantId", "workspaceId", "nativeScopeRef", "configDigest"]:
            require(binding[key] == projection[key])
        require(binding["servicePrincipalId"] == projection["gatewayPrincipalId"])
        identities = [value for value in self.adapter.get("nativeHumanIdentities", [])
                      if value["bindingId"] == projection["bindingId"]]
        require(len(identities) == 1 and identities[0]["generation"] == projection["generation"]
                and identities[0]["configDigest"] == projection["configDigest"])
        require(projection["secretReader"] in self.adapter["secretReaders"])
        models, routes, challenges = delivery["models"], projection["routes"], projection["deliveryChallenges"]
        require(isinstance(models, list) and models and len(models) == len(routes) == len(challenges))
        require(len({m["nativeModelRef"] for m in models}) == len(models))
        expected = set(projection["routeResourceIds"])
        require(len(expected) == len(models))
        require({m["routeResourceId"] for m in models} == expected
                and {r["resourceId"] for r in routes} == expected
                and {c["routeResourceId"] for c in challenges} == expected)
        for model in models:
            require(set(model) == {"routeResourceId", "nativeModelRef", "baseUrl"})
            require(canonical_uuid(model["routeResourceId"]))
            require(isinstance(model["nativeModelRef"], str) and model["nativeModelRef"]
                    and "\x00" not in model["nativeModelRef"])
            url = urlsplit(model["baseUrl"])
            require(url.scheme in ("http", "https") and url.netloc and not url.username
                    and not url.password and not url.query and not url.fragment)
        for challenge in challenges:
            require(re.fullmatch(r"[0-9a-f]{64}", challenge["verificationNonce"]))

    def publish(self, components, configs):
        if not self.enabled:
            return
        try:
            delivery, material, directory = self.documents
            projection = delivery["projection"]
            native = transform(configs)
            observed = {}

            def remember(reference, model, base, key):
                require(isinstance(key, str) and hmac.compare_digest(key, material["value"]))
                fact = (model, base, key)
                require(reference not in observed or observed[reference] == fact)
                observed[reference] = fact

            for name, component in components.items():
                for kind in ["llm", "embedder"]:
                    provider = getattr(component, kind + "_provider")
                    reference = native.pipelines[name][kind]
                    if provider is None:
                        require(reference is None)
                        continue
                    config = native.providers[kind][reference]
                    require(provider.get_model() == config["model"])
                    if kind == "llm":
                        require(not {"api_key", "api_base", "model", "api_version"}
                                & set(provider._model_kwargs))
                    if kind == "llm" and provider._has_fallbacks:
                        for model in provider._router.model_list:
                            params = model["litellm_params"]
                            aliases = [ref for ref, value in native.providers[kind].items()
                                       if value["model"] == params["model"]]
                            require(len(aliases) == 1)
                            remember(aliases[0], params["model"], params.get("api_base"), params.get("api_key"))
                    else:
                        remember(reference, provider.get_model(), provider._api_base, provider._api_key)
            require(set(observed) == {m["nativeModelRef"] for m in delivery["models"]})
            receipts = []
            for model in delivery["models"]:
                loaded_model, base, loaded_key = observed[model["nativeModelRef"]]
                route = next(r for r in projection["routes"] if r["resourceId"] == model["routeResourceId"])
                challenge = next(c for c in projection["deliveryChallenges"] if c["routeResourceId"] == model["routeResourceId"])
                require(loaded_model == "openai/" + route["nativeId"]
                        and base == model["baseUrl"].rstrip("/"))
                message = ("application-model-key:v1\x00" + projection["nativeScopeRef"] + "\x00"
                           + model["nativeModelRef"] + "\x00" + challenge["verificationNonce"])
                receipts.append({"bindingId": projection["bindingId"], "generation": projection["generation"],
                    "configDigest": projection["configDigest"], "servicePrincipalId": projection["gatewayPrincipalId"],
                    "routeResourceId": model["routeResourceId"], "nativeScopeRef": projection["nativeScopeRef"],
                    "nativeModelRef": model["nativeModelRef"], "secretRef": projection["serviceSecretRef"],
                    "requestId": material["requestId"], "verificationNonce": challenge["verificationNonce"],
                    "nativeProof": hmac.new(loaded_key.encode(), message.encode(), hashlib.sha256).hexdigest()})
            require([read_private(path) for path in self.paths] == self.documents)
            prior = self.adapter.get("modelCredentialDeliveries", [])
            require(isinstance(prior, list))
            same_binding = [r for r in prior if r["bindingId"] == projection["bindingId"]]
            require(all(type(r["generation"]) is int and r["generation"] <= projection["generation"]
                        and (r["generation"] != projection["generation"]
                             or r["configDigest"] == projection["configDigest"]) for r in same_binding))
            self.adapter["modelCredentialDeliveries"] = [r for r in prior
                if r["bindingId"] != projection["bindingId"] or r["generation"] != projection["generation"]] + receipts
            descriptor, temporary = tempfile.mkstemp(dir=Path(self.output).parent)
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                    json.dump(directory, stream, separators=(",", ":"))
                    stream.flush()
                    os.fsync(stream.fileno())
                require([read_private(path) for path in self.paths] == self.source_documents)
                require(not os.path.lexists(self.output))
                os.link(temporary, self.output, follow_symlinks=False)
                info = os.stat(self.output, follow_symlinks=False)
                self.published = (info.st_dev, info.st_ino)
                os.fsync(self.directory_fd)
            finally:
                os.unlink(temporary)
        except Exception:
            raise ModelDeliveryUnavailable() from None

    def _close(self):
        if self.directory_fd is not None:
            os.close(self.directory_fd)
            self.directory_fd = None

    def __exit__(self, *_):
        try:
            if self.published:
                try:
                    info = os.stat(self.output, follow_symlinks=False)
                    if (info.st_dev, info.st_ino) == self.published:
                        os.unlink(Path(self.output).name, dir_fd=self.directory_fd)
                        os.fsync(self.directory_fd)
                except FileNotFoundError:
                    pass
        finally:
            self._close()
