#!/usr/bin/env python3
"""Record the expected MCP answers of one protocol peer for its conformance environment (DD-136, 07 §8A).

The PROTOCOL_PEER arm of the original ComponentTask conformance (component_release_peer.rs) compares,
by exact JSON value, what Core's MCP client receives through an AgentGateway route with the
`initializeResultJson` / `listResultJson` of COMPONENT_CONFORMANCE_ENVIRONMENT_FILE. The Gateway does
not forward tools/list verbatim (it rebuilds the result and adds cache hints), so the expectation is
recorded through the same Gateway build instead of being typed in or taken from the peer directly:

  * an isolated `--internal` Docker network, created for this run and removed afterwards;
  * the peer container from the compose service named by the peer's mcpUrl host (same image digest,
    entrypoint, command, user and environment as deploy/local/compose.yaml);
  * a disposable Gateway from the image the running `agentgateway` service uses, which must be the
    compose pin, with a route of the shape Core publishes (stateless, conditional prefix, fail closed,
    one MCP target) and no admin, storage or authentication;
  * a client that speaks the handshake of Core's rmcp client (`().serve(...)`: protocol 2025-11-25,
    empty capabilities, clientInfo rmcp 3.1.2) and then lists tools without a cursor.

Two independent sessions must return the same answers, otherwise the peer is not deterministic and
nothing is written. Nothing touches the platform's containers, networks, databases or Gateway
configuration; no credential is read. With --write the conformance file of the peer is updated in
place (only the two expectation fields); without it the script exits 1 when the file differs.

Run on the CI node from a checkout of the commit to be released:
  python3 -I deploy/local/protocol-peers/record-conformance.py --peer protocol-peer-reference [--write]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from urllib.parse import urlsplit

import yaml

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.realpath(__file__))
ROOT = os.path.realpath(os.path.join(HERE, "..", "..", ".."))
COMPOSE = os.path.join(ROOT, "deploy", "local", "compose.yaml")
DIRECTORY = os.path.join(HERE, "directory.json")
DOCKER = ["sudo", "-n", "docker"]
# Core's MCP client: rmcp 3.1.2 `().serve(transport)` = ClientInfo::default() (core/Cargo.lock pins rmcp =3.1.2).
CLIENT_INITIALIZE = {"protocolVersion": "2025-11-25", "capabilities": {},
                     "clientInfo": {"name": "rmcp", "version": "3.1.2"}}
CAPTURE_CPUS, CAPTURE_MEMORY = "0.5", "256m"

CLIENT = r"""
const [url, init] = [process.argv[1], JSON.parse(process.argv[2])];
const base = {"content-type": "application/json", "accept": "application/json, text/event-stream"};
async function post(message, extra) {
  const reply = await fetch(url, {method: "POST", headers: {...base, ...extra}, body: JSON.stringify(message)});
  const text = await reply.text();
  const messages = [];
  if ((reply.headers.get("content-type") || "").includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data) messages.push(JSON.parse(data));
    }
  } else if (text) {
    messages.push(JSON.parse(text));
  }
  return {status: reply.status, session: reply.headers.get("mcp-session-id"), messages};
}
function result(reply, id) {
  const found = reply.messages.find((m) => m.id === id);
  if (reply.status !== 200 || !found || found.error || found.result === undefined) {
    throw new Error(`request ${id}: HTTP ${reply.status} ${JSON.stringify(found && found.error)}`);
  }
  return found.result;
}
let initialized;
for (let attempt = 0; ; attempt++) {
  try {
    initialized = await post({jsonrpc: "2.0", id: 0, method: "initialize", params: init}, {});
    if (initialized.status === 200) break;
  } catch (error) {}
  if (attempt >= 60) throw new Error("Gateway or peer not ready");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const initialize = result(initialized, 0);
const headers = {"mcp-protocol-version": initialize.protocolVersion};
if (initialized.session) headers["mcp-session-id"] = initialized.session;
const note = await post({jsonrpc: "2.0", method: "notifications/initialized"}, headers);
if (note.status >= 300) throw new Error(`notifications/initialized: HTTP ${note.status}`);
const list = result(await post({jsonrpc: "2.0", id: 1, method: "tools/list"}, headers), 1);
process.stdout.write(JSON.stringify({initialize, list}));
"""


class Refused(Exception):
    pass


def docker(*args, check=True):
    result = subprocess.run(DOCKER + list(args), capture_output=True, text=True)
    if check and result.returncode:
        tail = (result.stderr.strip().splitlines() or [""])[-1][:300]
        raise Refused(f"docker {args[0]} exited {result.returncode}: {tail}")
    return result.stdout.strip()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def peer_entry(directory, reference):
    found = [p for p in directory.get("protocolPeers") or [] if p.get("adapterServiceRef") == reference]
    if len(found) != 1:
        raise Refused(f"{reference}: not exactly one protocolPeers entry in {DIRECTORY}")
    return found[0]


def peer_service(compose, peer):
    """Compose service behind the peer endpoint; its image must be the peer's artifactDigest."""
    url = urlsplit(peer["mcpUrl"])
    services = compose.get("services") or {}
    if url.scheme != "http" or url.hostname not in services or url.username or url.query or url.fragment:
        raise Refused("mcpUrl must be plain http to a compose service of this topology")
    spec = services[url.hostname]
    image = str(spec.get("image") or "")
    if not re.fullmatch(r"[a-z0-9./_-]+@sha256:" + re.escape(peer["artifactDigest"]), image):
        raise Refused(f"{url.hostname}: compose image is not pinned to the peer artifactDigest")
    return url.hostname, spec


def gateway_route(target, mcp_url):
    """Same backend shape as Core's temporary routes (component_release_peer.rs route())."""
    return {"binds": [{"port": 3000, "listeners": [{"protocol": "HTTP", "routes": [{
        "name": "record", "matches": [{"path": {"exact": "/record"}}],
        "backends": [{"mcp": {"statefulMode": "stateless", "prefixMode": "conditional", "failureMode": "failClosed",
                              "targets": [{"name": target, "mcp": {"host": mcp_url}}]}}]}]}]}]}


def running_gateway(compose):
    """Image of the running agentgateway service; must carry the compose pin."""
    project = str(compose.get("name") or "")
    pin = re.search(r"@(sha256:[0-9a-f]{64})$", str(compose["services"]["agentgateway"]["image"]))
    ids = docker("ps", "-q", "--no-trunc", "--filter", f"label=com.docker.compose.project={project}",
                 "--filter", "label=com.docker.compose.service=agentgateway").split()
    if len(ids) != 1 or not pin:
        raise Refused("agentgateway: not exactly one running container")
    ref = docker("inspect", "--format", "{{.Config.Image}}", ids[0])
    if not ref.endswith("@" + pin.group(1)):
        raise Refused("running agentgateway differs from the compose pin; record after it is deployed")
    return ref


def capture(spec, host, gateway_image, mcp_url, scratch, run_id):
    network = f"peer-record-{run_id}"
    names = [f"{network}-peer", f"{network}-gateway", f"{network}-client"]
    config = os.path.join(scratch, "gateway.yaml")
    with open(config, "w", encoding="utf-8") as stream:
        yaml.safe_dump(gateway_route(f"component-validation-{run_id}", mcp_url), stream)
    os.chmod(config, 0o644)
    os.chmod(scratch, 0o755)
    limits = ["--cpus", CAPTURE_CPUS, "--memory", CAPTURE_MEMORY, "--memory-swap", CAPTURE_MEMORY,
              "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--network", network]
    docker("network", "create", "--internal", network)
    try:
        peer = [*limits, "--name", names[0], "--network-alias", host, "--read-only", "--tmpfs", "/tmp"]
        if spec.get("user"):
            peer += ["--user", str(spec["user"])]
        for key, value in (spec.get("environment") or {}).items():
            if "${" in str(value):
                raise Refused(f"peer environment {key} must be a literal")
            peer += ["--env", f"{key}={value}"]
        entrypoint = list(spec.get("entrypoint") or [])
        if entrypoint:
            peer += ["--entrypoint", entrypoint[0]]
        docker("run", "-d", "--pull", "never", *peer, spec["image"], *entrypoint[1:], *(spec.get("command") or []))
        docker("run", "-d", "--pull", "never", *limits, "--name", names[1], "--read-only",
               "--mount", f"type=bind,src={config},dst=/etc/agentgateway/config.yaml,readonly",
               gateway_image, "-f", "/etc/agentgateway/config.yaml")
        url = f"http://{names[1]}:3000/record"
        answers = []
        for _ in range(2):
            out = docker("run", "--rm", "--pull", "never", *limits, "--name", names[2], "--read-only",
                         "--entrypoint", "node", spec["image"], "--input-type=module", "-e", CLIENT, url,
                         json.dumps(CLIENT_INITIALIZE))
            answers.append(json.loads(out))
        if canonical(answers[0]) != canonical(answers[1]):
            raise Refused("two sessions returned different answers; the peer is not deterministic")
        return answers[0]
    finally:
        for name in names:
            docker("rm", "-f", name, check=False)
        docker("network", "rm", network, check=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--peer", required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]*", args.peer):
        raise Refused("--peer must be an adapterServiceRef")
    with open(COMPOSE, encoding="utf-8") as stream:
        compose = yaml.safe_load(stream)
    with open(DIRECTORY, encoding="utf-8") as stream:
        peer = peer_entry(json.load(stream), args.peer)
    host, spec = peer_service(compose, peer)
    target = os.path.join(HERE, "conformance", f"{args.peer}.json")
    with open(target, encoding="utf-8") as stream:
        environment = json.load(stream)
    if environment.get("artifactDigest") != peer["artifactDigest"] or environment.get("mcpUrl") != peer["mcpUrl"]:
        raise Refused("conformance environment must name the same artifactDigest and mcpUrl as the directory")
    gateway = running_gateway(compose)
    docker("pull", "-q", spec["image"])
    run_id = uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix="peer-record-") as scratch:
        answers = capture(spec, host, gateway, peer["mcpUrl"], scratch, run_id)
    recorded = dict(environment, initializeResultJson=canonical(answers["initialize"]),
                    listResultJson=canonical(answers["list"]))
    tools = [t.get("name") for t in answers["list"].get("tools") or []]
    missing = sorted(set(environment.get("readOnlyTools") or []) - set(tools))
    if missing:
        raise Refused(f"readOnlyTools not offered by the peer: {missing}")
    print(json.dumps({"peer": args.peer, "gateway": gateway, "image": spec["image"],
                      "protocolVersion": answers["initialize"].get("protocolVersion"),
                      "server": answers["initialize"].get("serverInfo"), "tools": tools,
                      "changed": recorded != environment}, ensure_ascii=False, indent=2))
    if recorded == environment:
        return 0
    if not args.write:
        return 1
    with open(target, "w", encoding="utf-8") as stream:
        json.dump(recorded, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as error:
        sys.exit(f"record-conformance: {error}")
