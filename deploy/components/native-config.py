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
``apply`` additionally publishes the rendered text atomically (owner-only 0600) and
copies the previous file into the given backup directory. A missing or malformed
fact refuses: nothing falls back to a template or upstream default. Output lists key
paths only, never values; the result line is JSON on stdout.

Usage (component-deploy.sh, KAILO_RUNTIME_DIR exported by runtime-dir.sh):
  native-config.py check|apply data-query --env <component env> [--source <commit>] [--backup-dir <dir>]
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def _framework():
    spec = importlib.util.spec_from_file_location("native_model_delivery", HERE / "native-model-delivery.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


delivery = _framework()
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


# One entry per component whose native file is rendered. ``facts``: placeholder name ->
# (source, parser); source "component" = component env, "platform" = runtime .env.
SPECS = {
    "data-query": {
        "template": ROOT / "data-query/docker/config.template.yaml",
        "destination_dir": "WREN_PROJECT_DIR",
        "destination": "config.yaml",
        "facts": {
            "WREN_MODEL_CHAT_ID": ("component", pattern(MODEL_ID)),
            "WREN_MODEL_CHAT_CONTEXT_WINDOW": ("component", positive_int),
            "WREN_MODEL_EMBEDDING_ID": ("component", pattern(MODEL_ID)),
            "WREN_MODEL_EMBEDDING_DIM": ("component", positive_int),
            "WREN_MODEL_API_KEY_NAME": ("component", pattern(ENV_NAME)),
            "AGENTGATEWAY_MODEL_BASE_URL": ("platform", pattern(BASE_URL)),
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


def facts(spec, component_env, runtime):
    platform = None
    result = {}
    for name, (source, parse) in spec["facts"].items():
        if source == "platform":
            if platform is None:
                platform = env_file(runtime / ".env")
            raw = platform_value(platform, name)
        else:
            raw = component_env.get(name, "")
            require(raw and "$" not in raw, "component env lacks deployment fact " + name)
        try:
            result[name] = parse(raw)
        except Refused:
            raise Refused("deployment fact " + name + " is malformed")
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

    template = list(yaml.safe_load_all(spec["template"].read_text(encoding="utf-8")))
    used = set()
    documents = [substitute(document, values, used) for document in template if document is not None]
    require(used == set(spec["facts"]), "template and declared deployment facts differ")
    header = ("# Generated by deploy/components/native-config.py from "
              + str(spec["template"].relative_to(ROOT)) + (" at " + source if source else "") + ".\n"
              + "# Do not edit: change the template or the deployment facts and redeploy.\n")
    text = header + yaml.safe_dump_all(documents, sort_keys=False, explicit_start=True, allow_unicode=True,
                                       default_flow_style=False)
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


def wren_check(values, component_env, documents):
    """The rendered file must pass the rule materialize-wren applies to it (DD-128):
    every model on the AgentGateway listener with a named key; with a native model
    delivery directory, the models are exactly the binding's frozen projection."""
    directory = component_env.get("WREN_NATIVE_MODEL_DELIVERY_DIR", "")
    native_models = None
    if directory:
        projection = delivery.validate_projection(
            delivery.document(delivery.private_path(directory, directory=True) / "projection.json"))
        native_models = projection["nativeModels"]
    names = delivery.wren_models(documents, values["AGENTGATEWAY_MODEL_BASE_URL"], native_models)
    require(names == [values["WREN_MODEL_API_KEY_NAME"]], "rendered models must all use the declared key name")


CONSUMER_CHECKS = {"data-query": wren_check}


def run(operation, component, env_path, source, backup, environ):
    import yaml

    require(component in SPECS, "no rendered native configuration for " + component)
    spec = SPECS[component]
    runtime = delivery.runtime_dir(environ)
    component_env = env_file(delivery.private_path(env_path))
    values = facts(spec, component_env, runtime)
    directory = delivery.private_path(component_env.get(spec["destination_dir"], ""), directory=True)
    destination = directory / spec["destination"]
    text, documents = render(spec, values, source)
    CONSUMER_CHECKS[component](values, component_env, documents)
    previous_text = delivery.read(destination) if os.path.lexists(destination) else None
    previous = list(yaml.safe_load_all(previous_text)) if previous_text is not None else None
    previous = [d for d in previous if d is not None] if previous is not None else None
    diff = changes(previous, documents) if previous is not None else []
    changed = previous is None or previous != documents
    rewrite = previous_text != text
    for sign, key in diff:
        print(f"  {sign} {key}", file=sys.stderr)
    state = "absent" if previous is None else "semantic changes" if changed else "semantically equal"
    print(f"{component} {spec['destination']}: {state}; {len(diff)} key path(s) differ"
          + (" (key names only)" if diff else ""), file=sys.stderr)
    if operation == "apply" and rewrite:
        if previous_text is not None:
            require(backup, "apply over an existing file needs --backup-dir")
            # Same atomic owner-only publication as the destination (mkstemp is 0600).
            delivery.write(delivery.private_path(backup, directory=True) / spec["destination"], previous_text)
        delivery.write(destination, text)
        delivery.private_path(str(destination))
    return {"operation": operation, "component": component, "destination": str(destination),
            "changed": changed, "written": operation == "apply" and rewrite,
            "keys": [sign + " " + key for sign, key in diff]}


def main(argv, environ):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("operation", choices=("check", "apply"))
    parser.add_argument("component")
    parser.add_argument("--env", required=True)
    parser.add_argument("--source", default="")
    parser.add_argument("--backup-dir", default="")
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        raise Refused("usage: native-config.py check|apply <component> --env <file> [--source <commit>] [--backup-dir <dir>]")
    require(not args.source or re.fullmatch(r"[0-9a-f]{40}", args.source), "--source must be a full commit")
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
