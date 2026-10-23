"""Render a component's native configuration file from its repository template and
declarative deployment facts (DD-127(7), DD-128).

The deployed native file is never maintained by hand. Two kinds of input exist:

* the **template** in the fixed release tree: everything that is the same for every
  deployment (pipelines, tuning, settings); deployment facts appear only as
  ``${NAME}`` placeholders inside string scalars;
* the **deployment facts**: values that differ per deployment (route ids, embedding
  dimension, key name, Gateway address), read from the component env (owner-only,
  literal values) or the platform ``.env`` of the runtime directory (ADR-20 §3/§4).

``check`` renders in memory and prints the key-level difference to the deployed file;
``apply`` additionally publishes the rendered text atomically (owner-only 0600, or
0644 for a declaration without secrets that a non-root native process reads) and
copies the previous file into the given backup directory. Before anything is
published, the rendered result must pass the same rule the component's
``materialize-<component>`` applies (one function in native-model-delivery.py). A missing or malformed
fact refuses: nothing falls back to a template or upstream default. Output lists key
paths only, never values; the result line is JSON on stdout.

A JSON template (``format: json``) is rendered as JSON; facts a template needs in
another form are ``derived`` from declared facts, never read separately.

Usage (component-deploy.sh, KAILO_RUNTIME_DIR exported by runtime-dir.sh):
  native-config.py check|apply data-query|knowledge|document-editor --env <component env> [--source <commit>] [--backup-dir <dir>]
  native-config.py stage document-editor --env <component env> --scratch-dir <owner-only empty dir> [--source <commit>]

``stage`` serves ``--check`` before a first deployment: it renders into the scratch
directory with an env copy pointing there, so the consumer's check needs no deployed file.
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


delivery = _module("native_model_delivery", HERE / "native-model-delivery.py")
# The document-editor image consumes local.json through this module at start
# (entrypoint); the renderer applies the same invariants before publishing.
document_editor_runtime = _module("document_editor_runtime", ROOT / "document-editor/fork/packaging/runtime-config.py")
Refused, require = delivery.Refused, delivery.require

MODEL_ID = re.compile(r"[A-Za-z0-9._:/-]+")  # validate_projection's native model id rule
ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
BASE_URL = re.compile(r"https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?")
PLACEHOLDER = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def positive_int(raw):
    require(re.fullmatch(r"[1-9][0-9]{0,8}", raw), "must be a positive integer")
    return int(raw)


def pattern(regex):
    def parse(raw):
        require(regex.fullmatch(raw), "malformed value")
        return raw
    return parse


def key_reference(raw):
    """A key name declared for the WeKnora loader: rendered as its own ``${NAME}``
    reference, which the native loader (not this renderer) resolves at startup."""
    require(re.fullmatch(delivery.WEKNORA_KEY_NAME, raw), "must be a KAILO_MODEL_* key name")
    return "${" + raw + "}"


def explicit_origin(raw):
    parts = urlsplit(raw)
    require(parts.scheme in ("http", "https") and parts.hostname and not parts.username and not parts.password
            and raw == f"{parts.scheme}://{parts.netloc}" and not any(c in raw for c in "*;'\"\\ "),
            "explicit scheme://host[:port] origin required")
    return raw


def directory_file(directory_key, name):
    """The fixed file name inside an owner-only directory named by the component env."""
    return lambda env: delivery.private_path(env.get(directory_key, ""), directory=True) / name


def named_file(file_key):
    """A file named by the component env: absolute, inside an owner-only directory."""
    def destination(env):
        raw = env.get(file_key, "")
        path = Path(raw)
        require(path.is_absolute() and str(path) == raw and path.name not in ("", ".", "..")
                and path.parent.is_dir(), file_key + " must be an absolute file path in an existing directory")
        return delivery.private_path(str(path.parent), directory=True) / path.name
    destination.key = file_key
    return destination


# One entry per component whose native file is rendered. ``facts``: placeholder name ->
# (source, parser); source "component" = component env, "platform" = runtime .env.
# ``destination``: the deployed file from the component env; ``mode``: its publication
# mode; ``quoted``: rendered strings that must be double-quoted for the native reader.
SPECS = {
    "data-query": {
        "template": ROOT / "data-query/docker/config.template.yaml",
        "destination": directory_file("WREN_PROJECT_DIR", "config.yaml"),
        "mode": 0o600,
        "facts": {
            "WREN_MODEL_CHAT_ID": ("component", pattern(MODEL_ID)),
            "WREN_MODEL_CHAT_CONTEXT_WINDOW": ("component", positive_int),
            "WREN_MODEL_EMBEDDING_ID": ("component", pattern(MODEL_ID)),
            "WREN_MODEL_EMBEDDING_DIM": ("component", positive_int),
            "WREN_MODEL_API_KEY_NAME": ("component", pattern(ENV_NAME)),
            "AGENTGATEWAY_MODEL_BASE_URL": ("platform", pattern(BASE_URL)),
        },
    },
    # DD-128(5), SF-WEK-17: the WeKnora built-in model declaration. No secret: the key
    # stays in the component-only env, the declaration only names it.
    "knowledge": {
        "template": ROOT / "deploy/components/knowledge-builtin-models.template.yaml",
        "destination": named_file("KNOWLEDGE_BUILTIN_MODELS_FILE"),
        "mode": 0o644,
        "quoted": re.compile(r"\$\{" + delivery.WEKNORA_KEY_NAME + r"\}"),
        "facts": {
            "KNOWLEDGE_MODEL_CHAT_ID": ("component", pattern(MODEL_ID)),
            "KNOWLEDGE_MODEL_EMBEDDING_ID": ("component", pattern(MODEL_ID)),
            "KNOWLEDGE_MODEL_EMBEDDING_DIM": ("component", positive_int),
            "KNOWLEDGE_MODEL_API_KEY_NAME": ("component", key_reference),
            "AGENTGATEWAY_MODEL_BASE_URL": ("platform", pattern(BASE_URL)),
        },
    },
    # DD-132(3): DocumentServer local.json. No secret: token secrets are read from
    # the runtime file the image entrypoint writes, the cache signing secret is
    # layered in at start.
    "document-editor": {
        "template": ROOT / "document-editor/deploy/local.template.json",
        "format": "json",
        "destination": named_file("DOCUMENT_EDITOR_LOCAL_CONFIG_FILE"),
        "mode": 0o644,
        "facts": {
            "DOCUMENT_EDITOR_PUBLIC_ORIGIN": ("component", explicit_origin),
            "DOCUMENT_EDITOR_WOPI_SOURCE_ORIGIN": ("component", explicit_origin),
        },
        "derived": {
            "DOCUMENT_EDITOR_WOPI_SOURCE_HOST": lambda values: urlsplit(values["DOCUMENT_EDITOR_WOPI_SOURCE_ORIGIN"]).hostname,
        },
    },
}


def env_file(path):
    """KEY=VALUE lines as component-deploy.sh env_value reads them (one pair of quotes
    stripped). Duplicate keys are refused; values are taken literally."""
    values = {}
    for line in delivery.read(path).splitlines():
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line.strip())
        if not match:
            continue
        name, value = match[1], match[2]
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        require(name not in values, "duplicate key " + name)
        values[name] = value
    return values


def platform_value(values, name, seen=()):
    """A platform .env value with ADR-20 §4 ``${NAME}`` references resolved from the same file."""
    require(name in values and name not in seen, "platform .env lacks " + name + " or has a cyclic reference")
    raw = values[name]
    require(not re.search(r"[\s'\"`\\]|\$(?!\{)", raw), "platform .env " + name + " is not a declarative value")
    return PLACEHOLDER.sub(lambda m: platform_value(values, m[1], seen + (name,)), raw)


def facts(spec, component_env, environ):
    platform = None
    result = {}
    for name, (source, parse) in spec["facts"].items():
        if source == "platform":
            if platform is None:
                platform = env_file(delivery.runtime_dir(environ) / ".env")
            raw = platform_value(platform, name)
        else:
            raw = component_env.get(name, "")
            require(raw and "$" not in raw, "component env lacks deployment fact " + name)
        try:
            result[name] = parse(raw)
        except Refused:
            raise Refused("deployment fact " + name + " is malformed")
    for name, derive in spec.get("derived", {}).items():
        result[name] = derive(result)
    return result


def substitute(node, values, used):
    if isinstance(node, dict):
        return {key: substitute(value, values, used) for key, value in node.items()}
    if isinstance(node, list):
        return [substitute(value, values, used) for value in node]
    if not isinstance(node, str) or "${" not in node:
        return node
    names = PLACEHOLDER.findall(node)
    require(names and all(n in values for n in names), "template placeholder is not a declared deployment fact")
    used.update(names)
    whole = PLACEHOLDER.fullmatch(node)
    if whole:
        return values[whole[1]]  # typed: an integer fact stays an integer
    return PLACEHOLDER.sub(lambda m: str(values[m[1]]), node)


def render(spec, values, source):
    import yaml

    if spec.get("format") == "json":
        used = set()
        document = substitute(json.loads(spec["template"].read_text(encoding="utf-8")), values, used)
        require(used == set(spec["facts"]) | set(spec.get("derived", {})), "template and declared deployment facts differ")
        text = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
        require(json.loads(text) == document, "rendered text does not round-trip")
        return text, [document]
    template = list(yaml.safe_load_all(spec["template"].read_text(encoding="utf-8")))
    used = set()
    documents = [substitute(document, values, used) for document in template if document is not None]
    require(used == set(spec["facts"]), "template and declared deployment facts differ")
    header = ("# Generated by deploy/components/native-config.py from "
              + str(spec["template"].relative_to(ROOT)) + (" at " + source if source else "") + ".\n"
              + "# Do not edit: change the template or the deployment facts and redeploy.\n")

    class Dumper(yaml.SafeDumper):
        pass

    quoted = spec.get("quoted")
    if quoted:
        Dumper.add_representer(str, lambda dumper, value: dumper.represent_scalar(
            "tag:yaml.org,2002:str", value, style='"' if quoted.fullmatch(value) else None))
    text = header + yaml.dump_all(documents, Dumper=Dumper, sort_keys=False, explicit_start=True,
                                  allow_unicode=True, default_flow_style=False)
    require(list(yaml.safe_load_all(text)) == documents, "rendered text does not round-trip")
    return text, documents


def flatten(node, path="", out=None):
    out = {} if out is None else out
    if isinstance(node, dict):
        for key, value in node.items():
            flatten(value, f"{path}.{key}" if path else str(key), out)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            flatten(value, f"{path}[{index}]", out)
    else:
        out[path] = node
    return out


def identify(documents):
    """Key each YAML document by its type/provider (or 'settings') so paths are stable."""
    keyed = {}
    for document in documents:
        if not isinstance(document, dict):
            name = "?"
        elif "type" in document:
            name = str(document["type"]) + ("/" + str(document["provider"]) if "provider" in document else "")
        else:
            name = "+".join(sorted(map(str, document)))
        require(name not in keyed, "two native configuration documents share the identity " + name)
        keyed[name] = document
    return keyed


def changes(old, new):
    """Key paths only: (+ added, - removed, ~ changed)."""
    before, after = flatten(identify(old)), flatten(identify(new))
    return ([("+", k) for k in after if k not in before] + [("-", k) for k in before if k not in after]
            + [("~", k) for k in after if k in before and before[k] != after[k]])


def frozen_models(component_env, directory_key):
    """With a native model delivery directory, the binding's frozen native model set."""
    directory = component_env.get(directory_key, "")
    if not directory:
        return None
    projection = delivery.validate_projection(
        delivery.document(delivery.private_path(directory, directory=True) / "projection.json"))
    return projection["nativeModels"]


def wren_check(values, component_env, documents, text):
    """The rendered file must pass the rule materialize-wren applies to it (DD-128):
    every model on the AgentGateway listener with a named key; with a native model
    delivery directory, the models are exactly the binding's frozen projection."""
    names = delivery.wren_models(documents, values["AGENTGATEWAY_MODEL_BASE_URL"],
                                 frozen_models(component_env, "WREN_NATIVE_MODEL_DELIVERY_DIR"))
    require(names == [values["WREN_MODEL_API_KEY_NAME"]], "rendered models must all use the declared key name")


def weknora_check(values, component_env, documents, text):
    """The rendered text must pass the rule materialize-weknora applies to the deployed
    file (DD-128(5)): Gateway models of the frozen set, one quoted reference each."""
    names = delivery.weknora_models(text, values["AGENTGATEWAY_MODEL_BASE_URL"],
                                    frozen_models(component_env, "KNOWLEDGE_NATIVE_MODEL_DELIVERY_DIR"))
    require(["${" + name + "}" for name in names] == [values["KNOWLEDGE_MODEL_API_KEY_NAME"]],
            "rendered models must all use the declared key name")


def document_editor_check(values, component_env, documents, text):
    """The rendered local.json must pass the invariants the image entrypoint checks
    at start (document-editor/fork/packaging/runtime-config.py, DD-132(3))."""
    try:
        document_editor_runtime.invariants(documents[0], values["DOCUMENT_EDITOR_PUBLIC_ORIGIN"])
    except (document_editor_runtime.Refused, KeyError, TypeError, ValueError):
        raise Refused("rendered local.json breaks the DD-132(3) invariants")


CONSUMER_CHECKS = {"data-query": wren_check, "knowledge": weknora_check, "document-editor": document_editor_check}


def run(operation, component, env_path, source, backup, environ):
    import yaml

    require(component in SPECS, "no rendered native configuration for " + component)
    spec = SPECS[component]
    component_env = env_file(delivery.private_path(env_path))
    values = facts(spec, component_env, environ)
    destination = spec["destination"](component_env)
    shared = bool(spec["mode"] & 0o044)
    text, documents = render(spec, values, source)
    CONSUMER_CHECKS[component](values, component_env, documents, text)
    previous_text = delivery.read(destination, shared=shared) if os.path.lexists(destination) else None
    if previous_text is not None and spec.get("format") == "json":
        previous = [json.loads(previous_text)]
    else:
        previous = list(yaml.safe_load_all(previous_text)) if previous_text is not None else None
    previous = [d for d in previous if d is not None] if previous is not None else None
    diff = changes(previous, documents) if previous is not None else []
    changed = previous is None or previous != documents
    rewrite = previous_text != text
    for sign, key in diff:
        print(f"  {sign} {key}", file=sys.stderr)
    state = "absent" if previous is None else "semantic changes" if changed else "semantically equal"
    print(f"{component} {destination.name}: {state}; {len(diff)} key path(s) differ"
          + (" (key names only)" if diff else ""), file=sys.stderr)
    if operation == "apply" and rewrite:
        if previous_text is not None:
            require(backup, "apply over an existing file needs --backup-dir")
            # Same atomic owner-only publication as the destination (mkstemp is 0600).
            delivery.write(delivery.private_path(backup, directory=True) / destination.name, previous_text)
        delivery.write(destination, text, spec["mode"])
        delivery.private_path(str(destination), shared=shared)
    return {"operation": operation, "component": component, "destination": str(destination),
            "changed": changed, "written": operation == "apply" and rewrite,
            "keys": [sign + " " + key for sign, key in diff]}


def stage(component, env_path, source, scratch, environ):
    """``--check`` of a first deployment: the deployed file is rendered only by a real
    deployment, so it cannot be the thing a check reads. Render into an owner-only
    scratch directory instead, together with a copy of the component env whose
    destination key names the staged file, so the consumer's own check runs on exactly
    what ``apply`` would publish. The controlled env and the deployed file are not
    touched; the caller removes the scratch directory."""
    require(component in SPECS, "no rendered native configuration for " + component)
    spec = SPECS[component]
    key = getattr(spec["destination"], "key", None)
    require(key, component + " has no single named file to stage")
    directory = delivery.private_path(scratch, directory=True)
    controlled = delivery.private_path(env_path)
    deployed = spec["destination"](env_file(controlled))
    staged_env, staged_file = directory / controlled.name, directory / deployed.name
    require(staged_env != staged_file and not os.path.lexists(staged_env) and not os.path.lexists(staged_file),
            "scratch directory must be empty")
    # Same line rule as env_file: the one destination line is replaced, nothing else changes.
    lines = [line for line in delivery.read(controlled).splitlines()
             if not re.fullmatch(re.escape(key) + r"=.*", line.strip())]
    delivery.write(staged_env, "\n".join(lines + [f"{key}={staged_file}"]) + "\n")
    result = run("apply", component, str(staged_env), source, "", environ)
    return {**result, "operation": "stage", "env": str(staged_env)}


def main(argv, environ):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("operation", choices=("check", "apply", "stage"))
    parser.add_argument("component")
    parser.add_argument("--env", required=True)
    parser.add_argument("--source", default="")
    parser.add_argument("--backup-dir", default="")
    parser.add_argument("--scratch-dir", default="")
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        raise Refused("usage: native-config.py check|apply|stage <component> --env <file> [--source <commit>] [--backup-dir <dir>] [--scratch-dir <dir>]")
    require(not args.source or re.fullmatch(r"[0-9a-f]{40}", args.source), "--source must be a full commit")
    require((args.operation == "stage") == bool(args.scratch_dir), "--scratch-dir is required by stage and only by stage")
    if args.operation == "stage":
        return stage(args.component, args.env, args.source, args.scratch_dir, environ)
    return run(args.operation, args.component, args.env, args.source, args.backup_dir, environ)


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:], os.environ)))
    except Refused as error:
        print("native configuration refused: " + str(error) + "; nothing was written", file=sys.stderr)
        sys.exit(78)
    except Exception:
        # Parser diagnostics may quote env lines; never print them.
        print("native configuration refused: unreadable template, env or destination; nothing was written",
              file=sys.stderr)
        sys.exit(78)
