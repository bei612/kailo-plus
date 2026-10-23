"""Pure parts of the CI node release stages (ADR-20): python3 -I -m unittest discover -s tools/release"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("release_node", os.path.join(os.path.dirname(__file__), "node.py"))
node = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(node)

PIN = "sha256:" + "e" * 64
REF = "127.0.0.1:55000/metering@" + PIN


class JudgeImage(unittest.TestCase):
    def test_containerd_store_image_id_is_the_manifest_digest(self):
        self.assertEqual(node.judge_image(PIN, REF, PIN, PIN, True), [])

    def test_graph_driver_config_id_differs_from_the_pin(self):
        config = "sha256:" + "c" * 64
        self.assertEqual(node.judge_image(PIN, REF, config, config, True), [])

    def test_reference_must_carry_the_pin(self):
        other = "127.0.0.1:55000/metering@sha256:" + "a" * 64
        self.assertIn("运行镜像引用与 pin 不一致", node.judge_image(PIN, other, PIN, PIN, True))

    def test_local_resolution_must_be_the_running_image(self):
        self.assertIn("pin 引用解析出的镜像与容器运行镜像不同",
                      node.judge_image(PIN, REF, PIN, "sha256:" + "b" * 64, True))
        self.assertIn("本节点无法解析 pin 引用", node.judge_image(PIN, REF, PIN, None, True))

    def test_a_local_only_image_is_not_reproducible(self):
        self.assertIn("产物不在 registry，不可复现", node.judge_image(PIN, REF, PIN, PIN, False))
        self.assertIn("无法确认产物在 registry 中", node.judge_image(PIN, REF, PIN, PIN, None))


class RegistryReference(unittest.TestCase):
    def test_references_without_a_registry_host_are_unknown(self):
        self.assertIsNone(node.registry_has("metering@" + PIN))
        self.assertIsNone(node.registry_has("local/metering@" + PIN))
        self.assertIsNone(node.registry_has("127.0.0.1:55000/metering:tag"))

    def test_unreachable_registry_is_unknown_not_absent(self):
        self.assertIsNone(node.registry_has("127.0.0.1:9/metering@" + PIN, timeout=1))


def load_model():
    _mspec = importlib.util.spec_from_file_location("release_model", os.path.join(os.path.dirname(__file__), "model.py"))
    model = importlib.util.module_from_spec(_mspec)
    _mspec.loader.exec_module(model)
    return model


H1, H2 = "1" * 64, "2" * 64
TREE = "/volumes/kailo/ci/sources/" + "a" * 40 + "/apps/deploy/local"
OVERLAYS = ["secrets/agentgateway-service.compose.json"]


RUNTIME = "/volumes/kailo/apps/deploy/local"


def ctr(cid, config_hash, running=True, health="healthy", files=None, workdir=TREE, binds=None):
    return dict(id=cid, name=cid, image_ref=REF, image_id=PIN, running=running, exit_code=0, health=health,
                config_hash=config_hash, working_dir=workdir, binds=binds or {},
                config_files=files if files is not None else [workdir + "/compose.yaml"])


def rendered(**services):
    return dict(name="platform-local", services=services, configs={
        "ch_logs": {"content": "<clickhouse><metric_log remove=\"1\"/></clickhouse>\n"},
        "tpl": {"content": "price: $$5\n"},
        "otel": {"file": "/tree/telemetry-collector.yaml"}},
        secrets={"ch_password": {"file": RUNTIME + "/secrets/ch_password"}})


class ConfigHashes(unittest.TestCase):
    def test_parses_one_service_and_hash_per_line(self):
        text = f"clickhouse {H1}\nworker {H2}\nWARN ignored line\n"
        self.assertEqual(node.parse_config_hashes(text), {"clickhouse": H1, "worker": H2})


class ConfigDrift(unittest.TestCase):
    files = {"/tree/telemetry-collector.yaml": b"receivers: {}\n"}

    def drift(self, doc, hashes, found, inside=None):
        inside = inside or {}
        return node.config_drift(doc, hashes, found, lambda cid, target: inside.get((cid, target)),
                                 read_file=self.files.__getitem__, overlays=OVERLAYS)

    def test_equal_hash_and_content_is_not_drift(self):
        doc = rendered(otel={"configs": [{"source": "otel", "target": "/etc/otel.yaml"}]})
        got = self.drift(doc, {"otel": H1}, {"otel": [ctr("c1", H1)]},
                         {("c1", "/etc/otel.yaml"): b"receivers: {}\n"})
        self.assertEqual(got, dict(drift=[], absent=[], hash_skipped=[]))

    def test_hash_mismatch_is_drift(self):
        got = self.drift(rendered(kafka={}), {"kafka": H2}, {"kafka": [ctr("c1", H1)]})
        self.assertEqual([(d["service"], d["reasons"]) for d in got["drift"]], [("kafka", ["compose 配置哈希不同"])])

    def test_config_content_change_is_drift_although_the_hash_is_equal(self):
        # Compose 的服务哈希不含 configs 内容：ClickHouse 的 configs.content 变化只能由回读发现
        doc = rendered(clickhouse={"configs": [{"source": "ch_logs", "target": "/etc/ch.xml"}]})
        old = b"<clickhouse><trace_log remove=\"1\"/></clickhouse>\n"
        got = self.drift(doc, {"clickhouse": H1}, {"clickhouse": [ctr("c1", H1)]}, {("c1", "/etc/ch.xml"): old})
        self.assertEqual(got["drift"][0]["reasons"], ["配置 ch_logs 内容与容器内 /etc/ch.xml 不同"])

    def test_content_is_compared_unescaped(self):
        doc = rendered(svc={"configs": [{"source": "tpl", "target": "/t"}]})
        got = self.drift(doc, {"svc": H1}, {"svc": [ctr("c1", H1)]}, {("c1", "/t"): b"price: $5\n"})
        self.assertEqual(got["drift"], [])

    def test_missing_target_file_and_default_target(self):
        doc = rendered(svc={"configs": ["tpl"]})
        got = self.drift(doc, {"svc": H1}, {"svc": [ctr("c1", H1)]})
        self.assertEqual(got["drift"][0]["reasons"], ["配置 tpl 内容与容器内 /tpl 不同"])

    def test_one_shots_components_and_stopped_services_are_excluded(self):
        doc = rendered(**{"spicedb-schema": {"restart": "no"}, "keycloak": {}})
        found = {"spicedb-schema": [ctr("c1", H2, running=False)],
                 "keycloak": [ctr("c2", H1, running=False)],
                 # 组件服务：同项目标签下也不在本 compose 文件中，不参与比较
                 "cells": [ctr("c3", H2)]}
        got = self.drift(doc, {"spicedb-schema": H1, "keycloak": H1}, found)
        self.assertEqual(got, dict(drift=[], absent=["keycloak"], hash_skipped=[]))

    def test_one_time_overlays_skip_the_hash_but_not_the_content(self):
        doc = rendered(**{"core-bff": {"configs": [{"source": "tpl", "target": "/t"}]}})
        core = ctr("c1", H2, files=[TREE + "/compose.yaml", "/tmp/tmp.tZxh46qy7e"])
        got = self.drift(doc, {"core-bff": H1}, {"core-bff": [core]}, {("c1", "/t"): b"price: $5\n"})
        self.assertEqual(got, dict(drift=[], absent=[], hash_skipped=["core-bff"]))
        got = self.drift(doc, {"core-bff": H1}, {"core-bff": [core]}, {("c1", "/t"): b"old\n"})
        self.assertEqual(got["drift"][0]["reasons"], ["配置 tpl 内容与容器内 /t 不同"])

    def test_registered_overlays_and_older_trees_keep_the_hash_comparable(self):
        old = "/volumes/kailo/ci/sources/" + "b" * 40 + "/apps/deploy/local"
        files = [old + "/compose.yaml", old + "/secrets/agentgateway-service.compose.json"]
        self.assertEqual(node.foreign_compose_files(ctr("c", H1, files=files, workdir=old), OVERLAYS), [])
        runtime = ["/volumes/kailo/apps/deploy/local/secrets/agentgateway-service.compose.json"]
        self.assertEqual(node.foreign_compose_files(ctr("c", H1, files=[TREE + "/compose.yaml"] + runtime), OVERLAYS), [])

    def test_secret_mounted_through_an_old_release_tree_is_drift(self):
        doc = rendered(clickhouse={"secrets": ["ch_password"]})
        legacy = "/volumes/kailo/ci/sources/" + "c" * 40 + "/apps/deploy/local/secrets/ch_password"
        stale = ctr("c1", H1, binds={"/run/secrets/ch_password": legacy})
        got = self.drift(doc, {"clickhouse": H1}, {"clickhouse": [stale]})
        self.assertEqual(got["drift"][0]["reasons"], ["secret ch_password 的挂载来源不是运行目录中的投递"])
        fresh = ctr("c1", H1, binds={"/run/secrets/ch_password": RUNTIME + "/secrets/ch_password"})
        self.assertEqual(self.drift(doc, {"clickhouse": H1}, {"clickhouse": [fresh]})["drift"], [])

    def test_missing_desired_hash_stops(self):
        with self.assertRaises(node.NodeError):
            self.drift(rendered(kafka={}), {}, {"kafka": [ctr("c1", H1)]})


def services(**deps):
    """{服务: (镜像, depends_on 列表)}，按参数顺序即 compose 定义顺序。"""
    return {name: dict(image=image, digest=None, raw_image="postgres:16" if image == "pg" else str(image),
                       depends_on={d: "service_started" for d in dep}, restart=None, order=i)
            for i, (name, (image, dep)) in enumerate(deps.items())}


DECL = dict(services={"openbao": {"drift": "report"}, "core-bff": {"command": ["./start-core.sh"]}},
            order={"first": ["core", "worker"], "last": ["web-client"]})


class ConvergePlan(unittest.TestCase):
    model = load_model()
    svcs = services(**{
        "core-db": ("pg", []), "openbao": ("bao", []), "openbao-audit-bound": ("bao", ["openbao"]),
        "core-bff": ("core", ["core-db", "openbao"]), "worker": ("worker", ["core-bff"]),
        "kafka": ("kafka", []), "clickhouse": ("ch", []), "openmeter": ("om", ["kafka", "clickhouse"]),
        "sidecar": ("side", ["proxy"]), "proxy": ("proxy", ["worker"]), "buzz-web": ("web-client", [])})
    managed = {"core-bff": "core", "worker": "worker", "buzz-web": "web-client"}

    def plan(self, drift, targets=()):
        return self.model.converge_plan(self.svcs, drift, list(targets), self.managed, DECL)

    def test_report_policy_is_listed_not_recreated(self):
        p = self.plan(["openbao", "openbao-audit-bound"])
        self.assertEqual(p["report"], ["openbao"])
        self.assertEqual(p["before"], ["openbao-audit-bound"])

    def test_managed_drift_joins_the_replacement_in_03_order(self):
        p = self.plan(["buzz-web", "worker"], targets=["core-bff"])
        self.assertEqual(p["targets"], ["core-bff", "worker", "buzz-web"])
        self.assertEqual(p["before"] + p["after"], [])

    def test_dependencies_first_and_dependents_of_targets_after(self):
        # openmeter 依赖 kafka/clickhouse：二者先重建；sidecar 经 proxy 传递依赖替换对象 worker：替换之后
        p = self.plan(["sidecar", "openmeter", "clickhouse", "kafka", "core-db"], targets=["worker"])
        self.assertEqual(p["before"], ["core-db", "kafka", "clickhouse", "openmeter"])
        self.assertEqual(p["after"], ["sidecar"])
        self.assertEqual(p["targets"], ["worker"])

    def test_no_threshold_every_drifted_service_is_planned(self):
        everything = [s for s in self.svcs if s != "openbao"]
        p = self.plan(everything)
        self.assertEqual(sorted(p["targets"] + p["before"] + p["after"]), sorted(everything))

    def test_drifted_postgres_is_backed_up(self):
        self.assertEqual(self.model.converge_databases(self.svcs, self.plan(["core-db", "kafka"])), ["core-db"])

    def test_unknown_policy_is_rejected(self):
        with self.assertRaises(self.model.ReleaseError):
            self.model.drift_policy(dict(services={"x": {"drift": "skip"}}), "x")


class ConvergeJournal(unittest.TestCase):
    """deploy 的漂移重建：按给定顺序 up、逐个回读写日志；重跑以现场为准，已收敛的不再出现。"""

    def release(self, tmp, live):
        release = node.Release.__new__(node.Release)
        release.journal = tmp
        release.calls = []
        release.compose = lambda *args, **kw: release.calls.append(args)

        def readback(svc, doc, hashes):
            live[svc] = [ctr("new-" + svc, hashes[svc])]
            return dict(service=svc, config_hash=hashes[svc], health="healthy", container="new-" + svc)
        release.readback_config = readback
        return release

    def test_recreates_in_order_journals_each_and_reruns_idempotently(self):
        import tempfile
        doc = rendered(kafka={}, clickhouse={}, openmeter={})
        hashes = {"kafka": H2, "clickhouse": H2, "openmeter": H1}
        live = {"kafka": [ctr("k", H1)], "clickhouse": [ctr("c", H1)], "openmeter": [ctr("o", H1)]}
        with tempfile.TemporaryDirectory() as tmp:
            release = self.release(tmp, live)
            first = node.config_drift(doc, hashes, live, lambda *_: None)
            order = [d["service"] for d in first["drift"]]
            self.assertEqual(order, ["kafka", "clickhouse"])
            journal = dict(config_recreated=[], services=[], started_at=1, state="RUNNING")
            release.recreate_drifted(order, doc, hashes, journal)
            self.assertEqual([c[-1] for c in release.calls], ["kafka", "clickhouse"])
            self.assertTrue(all(c[:4] == ("up", "-d", "--no-deps", "--force-recreate") and "--wait" in c
                                for c in release.calls))
            with open(os.path.join(tmp, "deploy.json"), encoding="utf-8") as stream:
                saved = node.json.load(stream)
            self.assertEqual([s["service"] for s in saved["config_recreated"]], ["kafka", "clickhouse"])
            # 重跑：现场已收敛，没有漂移，也就没有重建
            self.assertEqual(node.config_drift(doc, hashes, live, lambda *_: None)["drift"], [])
            history = release.deploy_history()
            self.assertEqual(history[-1]["config_recreated"], ["kafka", "clickhouse"])


class DeployOrder(unittest.TestCase):
    """deploy 的统一顺序（ADR-20 §8/§9/§10）：配置一次性服务 → 创建缺失的运维域运行体 → 替换前的漂移重建 →
    keycloak 就绪后 IdP 声明 → 替换服务 → 替换后的漂移重建；journal 中漂移、idp 与运维域字段并存、不互相覆盖。"""

    def test_drift_before_idp_before_targets_before_drift_after(self):
        import tempfile
        events = []
        svcs = services(**{"keycloak": ("kc", []), "worker": ("worker", []), "sidecar": ("side", ["worker"])})
        doc = rendered(keycloak={}, worker={}, sidecar={})
        live = {"keycloak": [ctr("k", H1)], "worker": [ctr("w", H1)], "sidecar": [ctr("s", H1)]}
        hashes = {"keycloak": H2, "worker": H2, "sidecar": H2}

        class Model:
            converge_plan = staticmethod(load_model().converge_plan)
            prerequisites = staticmethod(lambda services, svc: [])

            @staticmethod
            def idp_declaration(decl):
                return dict(wait="keycloak")

        class Idp:
            def apply(self, commit):
                events.append("idp")
                return dict(applied=True, native_clients_declared=True, state="changed", commands=[])

        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "backups"))
            open(os.path.join(tmp, "backups", "manifest.json"), "w").close()
            r = node.Release.__new__(node.Release)
            r.model, r.decl, r.commit, r.journal, r.backups = Model, dict(DECL, overlays=[]), "c" * 40, tmp, \
                os.path.join(tmp, "backups")
            r.services, r.managed, r.cfg, r.ci_env = svcs, {"worker": "worker"}, dict(compose_project="p"), {}
            # 运维域运行体 peer 尚未运行：在漂移收敛与替换之前创建；没有投递声明
            r.operated, r.delivery = {"peer": "sha256:" + "d" * 64}, None
            r.readback_operated = lambda svc: dict(service=svc, operated=True)
            r.lock = lambda: open(os.devnull)
            r.normalize_tree = lambda: 0
            r.apply_env = lambda: {}
            r.desired = lambda: (doc, hashes)
            r.check_rendered = lambda rendered: None
            r.targets = lambda found: []
            r.migration_plan = lambda found: []
            r.apply_config_oneoffs = lambda: events.append("oneoffs") or []
            r.wait_ready = lambda svc: events.append("wait " + svc)
            r.idp_step = lambda: Idp()
            r.readback = lambda svc: dict(service=svc)
            r.readback_config = lambda svc, d, h: dict(service=svc)
            r.compose = lambda *args, **kw: events.append(args[0] + " " + args[-1])
            saved = node.containers, node.running_containers, node.container_file
            node.containers, node.running_containers, node.container_file = \
                (lambda project: live), (lambda: {}), (lambda cid, target: None)
            try:
                journal = r.deploy()
            finally:
                node.containers, node.running_containers, node.container_file = saved
        self.assertEqual(events, ["pull worker", "oneoffs", "up peer", "up keycloak", "wait keycloak", "idp",
                                  "up worker", "up sidecar"])
        self.assertEqual(journal["operated"], ["peer"])
        self.assertEqual(journal["services"][0], dict(service="peer", operated=True))
        self.assertEqual(journal["config_converge"]["before"], ["keycloak"])
        self.assertEqual(journal["config_converge"]["after"], ["sidecar"])
        self.assertEqual([s["service"] for s in journal["config_recreated"]], ["keycloak", "sidecar"])
        self.assertTrue(journal["idp"]["applied"])
        self.assertEqual(journal["state"], "SUCCEEDED")


class ConfigOneoffs(unittest.TestCase):
    def test_digest_follows_config_content_and_skips_deliveries(self):
        import tempfile
        model = load_model()
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "authorization"))
            with open(os.path.join(tmp, "authorization", "schema.zed"), "w") as stream:
                stream.write("definition principal {}\n")
            text = """
services:
  spicedb-schema: {restart: "no", configs: [{source: spicedb_schema, target: /etc/schema.zed}]}
  runtime-oneoff: {restart: "no", configs: [delivered]}
  long-running: {configs: [spicedb_schema]}
configs:
  spicedb_schema: {file: ./authorization/schema.zed}
  delivered: {file: "${KAILO_RUNTIME_DIR:-.}/secrets/x"}
"""
            first = model.config_oneoffs(text, tmp)
            self.assertEqual(list(first), ["spicedb-schema"])
            self.assertEqual(model.config_oneoffs(text, tmp), first)
            with open(os.path.join(tmp, "authorization", "schema.zed"), "a") as stream:
                stream.write("definition tenant {}\n")
            self.assertNotEqual(model.config_oneoffs(text, tmp), first)


def _model():
    spec = importlib.util.spec_from_file_location("release_model_peers", os.path.join(os.path.dirname(__file__), "model.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PEER_DIGEST = "d" * 64
PEER_COMPOSE = f"""
services:
  core-bff: {{image: "${{REGISTRY_HOST:?x}}/core@sha256:{'a' * 64}"}}
  protocol-peer-reference: {{image: "vendor/peer@sha256:{PEER_DIGEST}", restart: unless-stopped}}
  tagged: {{image: "vendor/peer:latest"}}
  oneoff: {{image: "vendor/peer@sha256:{PEER_DIGEST}", restart: "no"}}
"""


class OperatedAndPeerDelivery(unittest.TestCase):
    """ADR-20 §10: operated runtimes and the protocolPeers / conformance delivery declaration."""

    def setUp(self):
        import json
        import tempfile
        self.json = json
        self.model = _model()
        self.services = self.model.compose_services(PEER_COMPOSE)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.peer = {"adapterServiceRef": "protocol-peer-reference", "mcpUrl": "http://protocol-peer-reference:3001/mcp",
                     "nativeInstanceRef": "protocol-peer-reference", "artifactDigest": PEER_DIGEST,
                     "timeoutSeconds": 10, "maxResponseBytes": 262144, "bindings": []}
        self.conformance = {"artifactDigest": PEER_DIGEST, "mcpUrl": self.peer["mcpUrl"], "timeoutSeconds": 10,
                            "maxResponseBytes": 262144, "maxSteps": 16, "readOnlyTools": ["echo"],
                            "initializeResultJson": json.dumps({"protocolVersion": "2025-11-25"}),
                            "listResultJson": json.dumps({"tools": [{"name": "echo"}, {"name": "get-env"}]})}
        self.write()

    def write(self, directory=None, conformance=None):
        for name, value in (("directory.json", directory or {"protocolPeers": [self.peer]}),
                            ("conformance.json", conformance or self.conformance)):
            with open(os.path.join(self.tmp.name, name), "w", encoding="utf-8") as stream:
                stream.write(value if isinstance(value, str) else self.json.dumps(value))

    def decl(self, **override):
        env = {"set": {"APPLICATION_ADAPTER_DIRECTORY_FILE": "${KAILO_RUNTIME_DIR}/data/protocol-peers/adapter-directory.json",
                       "COMPONENT_CONFORMANCE_ENVIRONMENT_FILE":
                           "${KAILO_RUNTIME_DIR}/data/protocol-peers/conformance-environment.json"},
               "unset": ["COMPONENT_CONFORMANCE_FIXTURE_FILE", "COMPONENT_CONFORMANCE_IDENTITY_FILE"]}
        value = {"units": {}, "services": {"core-bff": {"command": ["./start-core.sh", "--no-build"]}},
                 "migrations": {}, "order": {}, "node": {}, "env": env, "operated": ["protocol-peer-reference"],
                 "delivery": {"protocol_peers": {"directory": os.path.join(self.tmp.name, "directory.json"),
                                                 "conformance": os.path.join(self.tmp.name, "conformance.json"),
                                                 "runtime": "data/protocol-peers", "restart": "core-bff"}}}
        value.update(override)
        return value

    def refused(self, fragment, decl=None):
        with self.assertRaises(self.model.ReleaseError) as caught:
            self.model.peer_delivery(decl or self.decl(), self.services)
        self.assertIn(fragment, str(caught.exception))

    def test_operated_accepts_only_pinned_upstream_long_running_services(self):
        self.assertEqual(self.model.operated_services(self.services, self.decl()),
                         {"protocol-peer-reference": "sha256:" + PEER_DIGEST})
        for name in ("core-bff", "tagged", "oneoff", "missing"):
            with self.assertRaises(self.model.ReleaseError):
                self.model.operated_services(self.services, self.decl(operated=[name]))

    def test_valid_declaration_and_its_digest_follow_content(self):
        first = self.model.peer_delivery(self.decl(), self.services)
        self.assertEqual(first["restart"], "core-bff")
        self.assertEqual(first["peers"], [self.peer])
        self.peer["bindings"] = [{"bindingId": "11111111-1111-4111-8111-111111111111",
                                  "tenantId": "22222222-2222-4222-8222-222222222222",
                                  "servicePrincipalId": "33333333-3333-4333-8333-333333333333",
                                  "nativeScopeRef": "default", "configDigest": "c" * 64,
                                  "isolationMode": "DEDICATED_INSTANCE"}]
        self.write()
        self.assertNotEqual(self.model.peer_delivery(self.decl(), self.services)["digest"], first["digest"])

    def test_endpoint_must_be_an_operated_runtime_with_the_pinned_digest(self):
        self.write({"protocolPeers": [dict(self.peer, mcpUrl="http://vendor.example/mcp")]},
                   dict(self.conformance, mcpUrl="http://vendor.example/mcp"))
        self.refused("operated")
        self.write({"protocolPeers": [dict(self.peer, artifactDigest="e" * 64)]},
                   dict(self.conformance, artifactDigest="e" * 64))
        self.refused("artifactDigest")
        self.write({"protocolPeers": [dict(self.peer, mcpUrl="http://u:p@protocol-peer-reference:3001/mcp")]})
        self.refused("mcpUrl")

    def test_directory_owns_only_protocol_peers_and_valid_binding_facts(self):
        self.write({"adapters": [], "protocolPeers": [self.peer]})
        self.refused("protocolPeers")
        self.write({"protocolPeers": [dict(self.peer, bindings=[{"bindingId": "x"}])]})
        self.refused("binding")
        self.write('{"protocolPeers": [], "protocolPeers": []}')
        with self.assertRaises(self.model.ReleaseError):
            self.model.peer_delivery(self.decl(), self.services)

    def test_conformance_must_be_recorded_and_match_one_peer(self):
        self.write(conformance=dict(self.conformance, initializeResultJson=""))
        self.refused("record-conformance.py")
        self.write(conformance=dict(self.conformance, readOnlyTools=["get-sum"]))
        self.refused("readOnlyTools")
        self.write(conformance=dict(self.conformance, mcpUrl="http://protocol-peer-reference:3002/mcp"))
        self.refused("一个 peer")
        self.write(conformance=dict(self.conformance, extra=True))
        self.refused("ComponentProtocolPeerEnvironment")

    def test_env_keys_must_point_at_the_rendered_files_and_clear_http_only_slots(self):
        decl = self.decl()
        decl["env"]["set"]["APPLICATION_ADAPTER_DIRECTORY_FILE"] = "/elsewhere/adapter-directory.json"
        self.refused("APPLICATION_ADAPTER_DIRECTORY_FILE", decl)
        decl = self.decl()
        decl["env"]["unset"] = ["COMPONENT_CONFORMANCE_FIXTURE_FILE"]
        self.refused("env.unset", decl)
        decl = self.decl()
        decl["delivery"]["protocol_peers"]["runtime"] = "../outside"
        self.refused("runtime", decl)
        self.assertIsNone(self.model.peer_delivery(self.decl(delivery={}), self.services))

    def test_rendered_directory_keeps_component_adapters_and_refuses_collisions(self):
        adapter = {"adapterServiceRef": "knowledge-adapter"}
        rendered = self.model.render_peer_directory({"adapters": [adapter], "protocolPeers": []}, [self.peer])
        self.assertEqual(rendered, {"adapters": [adapter], "protocolPeers": [self.peer]})
        self.assertEqual(self.model.render_peer_directory(None, [self.peer])["adapters"], [])
        for existing in ({"adapters": [{"adapterServiceRef": "protocol-peer-reference"}]},
                         {"adapters": [], "other": 1}, {"protocolPeers": []}, []):
            with self.assertRaises(self.model.ReleaseError):
                self.model.render_peer_directory(existing, [self.peer])


class RepositoryPeerDeclaration(unittest.TestCase):
    """The checked-in declaration itself: operated digest, recorded expectations and env keys agree."""

    def test_release_declaration_is_consistent(self):
        model = _model()
        delivery = model.peer_delivery()
        self.assertEqual([p["adapterServiceRef"] for p in delivery["peers"]], ["protocol-peer-reference"])
        listed = {t["name"] for t in __import__("json").loads(delivery["conformance"]["listResultJson"])["tools"]}
        self.assertTrue({"echo", "get-sum"} <= listed)


class DeliveryRendering(unittest.TestCase):
    """node.py renders the declaration into the runtime directory, keeps component adapters,
    rewrites nothing when unchanged and treats the delivery as effective only after record_delivery."""

    def release(self, tmp):
        import json
        model = _model()
        runtime, journal = os.path.join(tmp, "runtime"), os.path.join(tmp, "journal")
        os.makedirs(os.path.join(runtime, "data"))
        os.makedirs(journal)
        release = node.Release.__new__(node.Release)
        release.model, release.runtime = model, runtime
        release.delivery = model.peer_delivery()
        release.decl = {"node": {"journal": journal}}
        folder = os.path.join(runtime, "data", "protocol-peers")
        os.makedirs(folder)
        with open(os.path.join(folder, model.PEER_DIRECTORY_FILE), "w", encoding="utf-8") as stream:
            json.dump({"adapters": [{"adapterServiceRef": "knowledge-adapter"}]}, stream)
        return release, folder

    def test_render_keeps_adapters_is_idempotent_and_takes_effect_on_record(self):
        import json
        import stat
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            release, folder = self.release(tmp)
            model = release.model
            self.assertEqual(sorted(release.write_deliveries()),
                             sorted([model.PEER_CONFORMANCE_FILE, model.PEER_DIRECTORY_FILE]))
            self.assertEqual(release.write_deliveries(), [])
            with open(os.path.join(folder, model.PEER_DIRECTORY_FILE), encoding="utf-8") as stream:
                directory = json.load(stream)
            self.assertEqual(directory["adapters"], [{"adapterServiceRef": "knowledge-adapter"}])
            self.assertEqual(directory["protocolPeers"], release.delivery["peers"])
            for name in (model.PEER_DIRECTORY_FILE, model.PEER_CONFORMANCE_FILE):
                self.assertEqual(stat.S_IMODE(os.stat(os.path.join(folder, name)).st_mode), 0o644)
            self.assertTrue(release.delivery_pending())
            self.assertTrue(any("尚未" in p for p in release.delivery_problems()))
            release.record_delivery()
            self.assertFalse(release.delivery_pending())
            self.assertEqual(release.delivery_problems(), [])

    def test_symlinked_delivery_path_is_refused(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            release, folder = self.release(tmp)
            elsewhere = os.path.join(tmp, "elsewhere")
            os.rename(folder, elsewhere)
            os.symlink(elsewhere, folder)
            with self.assertRaises(node.NodeError):
                release.write_deliveries()

_ispec = importlib.util.spec_from_file_location(
    "idp_declarations", os.path.join(os.path.dirname(__file__), "..", "..", "deploy", "local", "idp-declarations.py"))
idp = importlib.util.module_from_spec(_ispec)
_ispec.loader.exec_module(idp)

# Values that must never appear in any output of the step (they stand for .env values).
SENTINELS = ("http://sentinel.example:1", "sentinel-browser", "sentinel-native", "sentinel-cells-client")
ENV = {"PUBLIC_HOST": ["sentinel.example"], "AGENTGATEWAY_PORT": ["1"],
       "PUBLIC_ORIGIN": ["http://${PUBLIC_HOST}:${AGENTGATEWAY_PORT}"],
       "NATIVE_OIDC_CLIENTS": ['sentinel-cells-client=http://c.example:2/oauth/backchannel-logout'],
       "UNRELATED": ["a"]}
KEYS = ["PUBLIC_ORIGIN", "NATIVE_OIDC_CLIENTS", "OIDC_ISSUER"]
FILES = "sha256:" + "1" * 64


class FakeRunner:
    """Stands in for bootstrap.sh: records argv, answers one JSON status line per mode."""

    def __init__(self, fail=None, native="DECLARED"):
        self.calls, self.fail, self.native = [], fail or {}, native

    def __call__(self, argv):
        self.calls.append(argv[1])
        code = self.fail.get(argv[1], 0)
        body = {"clients": 2, "changed": 0, "problems": ["x"] * code}
        if "native" in argv[1]:
            body = {"nativeClientProfiles": self.native, "clients": 1, "users": 3, "written": 0, "missing": 0,
                    "problems": ["x"] * code}
        # A misbehaving script must not leak values through the step either.
        body["unexpected"] = SENTINELS[1]
        return code, "progress line\n" + json.dumps(body) + "\n"


SPEC = {"wait": "keycloak", "inputs": "deploy/local/idp-declarations.py",
        "apply": [["./bootstrap.sh", "--sync-client-redirects"], ["./bootstrap.sh", "--declare-native-client-profiles"]],
        "always": [["./bootstrap.sh", "--declare-native-user-pictures"]],
        "verify": [["./bootstrap.sh", "--verify-client-redirects"], ["./bootstrap.sh", "--verify-native-client-profiles"]]}


class IdpDigest(unittest.TestCase):
    def test_digest_follows_referenced_env_and_files_only(self):
        base = node.idp_digest(FILES, ENV, KEYS)
        self.assertEqual(node.idp_digest(FILES, dict(ENV, UNRELATED=["b"]), KEYS), base)
        self.assertNotEqual(node.idp_digest(FILES, dict(ENV, PUBLIC_HOST=["other"]), KEYS), base)
        self.assertNotEqual(node.idp_digest(FILES, dict(ENV, NATIVE_OIDC_CLIENTS=[""]), KEYS), base)
        self.assertNotEqual(node.idp_digest("sha256:" + "2" * 64, ENV, KEYS), base)
        # the last assignment wins, as with bash `.`
        self.assertNotEqual(node.idp_digest(FILES, dict(ENV, PUBLIC_HOST=["sentinel.example", "x"]), KEYS), base)

    def test_inputs_come_from_the_declaration_file(self):
        _mspec = importlib.util.spec_from_file_location("release_model_idp", os.path.join(os.path.dirname(__file__), "model.py"))
        model = importlib.util.module_from_spec(_mspec)
        _mspec.loader.exec_module(model)
        spec = model.idp_declaration()
        self.assertEqual(spec["wait"], "keycloak")
        files, keys = model.idp_inputs()
        self.assertRegex(files, r"^sha256:[0-9a-f]{64}$")
        self.assertEqual(keys, sorted(idp.INPUT_ENV))
        for bad in ([["bootstrap.sh", "--x"]], [["./bootstrap.sh", "--x; rm"]], []):
            with self.assertRaises(model.ReleaseError):
                model.idp_declaration(dict(idp=dict(SPEC, apply=bad)))


class IdpStepTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.state = os.path.join(self.tmp.name, node.IDP_STATE)
        self.digest = node.idp_digest(FILES, ENV, KEYS)

    def tearDown(self):
        self.tmp.cleanup()

    def step(self, runner, env=ENV):
        return node.IdpStep(SPEC, node.idp_digest(FILES, env, KEYS), env, self.state, runner)

    def record(self, digest):
        node.write_json_atomic(self.state, dict(digest=digest))

    def assert_no_values(self, value):
        text = json.dumps(value, ensure_ascii=False)
        for sentinel in SENTINELS:
            self.assertNotIn(sentinel, text)

    def test_unchanged_digest_skips_the_declaration(self):
        self.record(self.digest)
        runner = FakeRunner()
        result = self.step(runner).apply("c" * 40)
        self.assertEqual(runner.calls, ["--declare-native-user-pictures"])
        self.assertFalse(result["applied"])
        self.assertEqual(node.read_json(self.state), dict(digest=self.digest))
        self.assert_no_values(result)

    def test_changed_digest_declares_then_records(self):
        self.record("sha256:" + "0" * 64)
        runner = FakeRunner()
        result = self.step(runner).apply("c" * 40)
        self.assertEqual(runner.calls, ["--sync-client-redirects", "--declare-native-client-profiles",
                                        "--declare-native-user-pictures"])
        self.assertTrue(result["applied"])
        self.assertEqual(result["state"], "changed")
        self.assertEqual(node.read_json(self.state)["digest"], self.digest)
        self.assert_no_values(result)
        self.assert_no_values(node.read_json(self.state))

    def test_first_deploy_declares(self):
        runner = FakeRunner()
        self.assertEqual(self.step(runner).apply("c" * 40)["state"], "never")
        self.assertEqual(len(runner.calls), 3)

    def test_empty_native_clients_is_recorded_as_undeclared(self):
        env = dict(ENV, NATIVE_OIDC_CLIENTS=[""])
        runner = FakeRunner(native="UNDECLARED")
        result = self.step(runner, env).apply("c" * 40)
        self.assertFalse(result["native_clients_declared"])
        self.assertIs(node.read_json(self.state)["native_clients_declared"], False)
        verified = self.step(FakeRunner(native="UNDECLARED"), env).verify()
        self.assertEqual(verified["native_client_profiles"], "UNDECLARED")
        self.assertEqual(verified["problems"], [])

    def test_failure_stops_and_does_not_record(self):
        runner = FakeRunner(fail={"--sync-client-redirects": 78})
        with self.assertRaises(node.NodeError):
            self.step(runner).apply("c" * 40)
        self.assertEqual(runner.calls, ["--sync-client-redirects"])
        self.assertFalse(os.path.exists(self.state))

    def test_drift_found_by_the_user_pass_invalidates_the_digest(self):
        self.record(self.digest)
        with self.assertRaises(node.NodeError):
            self.step(FakeRunner(fail={"--declare-native-user-pictures": 78})).apply("c" * 40)
        self.assertIsNone(node.read_json(self.state)["digest"])
        self.assertEqual(self.step(FakeRunner()).plan()["state"], "never")

    def test_verify_readback_mismatch_fails(self):
        self.record(self.digest)
        ok = self.step(FakeRunner()).verify()
        self.assertEqual(ok["problems"], [])
        self.assertEqual(ok["native_client_profiles"], "DECLARED")
        bad = self.step(FakeRunner(fail={"--verify-native-client-profiles": 1})).verify()
        self.assertEqual(len(bad["problems"]), 1)
        self.assert_no_values(bad)
        self.record("sha256:" + "0" * 64)
        self.assertEqual(len(self.step(FakeRunner()).verify()["problems"]), 1)

    def test_plan_is_read_only(self):
        runner = FakeRunner()
        before = sorted(os.listdir(self.tmp.name))
        plan = self.step(runner).plan()
        self.assertEqual(plan, dict(state="never", native_clients_declared=True))
        self.assertEqual(runner.calls, [])
        self.assertEqual(sorted(os.listdir(self.tmp.name)), before)


TEMPLATE = {"clients": [
    {"clientId": "__OIDC_BROWSER_CLIENT_ID__", "secret": "__BROWSER_CLIENT_SECRET__",
     "redirectUris": ["__OIDC_REDIRECT_URI__"], "webOrigins": ["+"],
     "attributes": {"post.logout.redirect.uris": "__OIDC_POST_LOGOUT_REDIRECT_URI__"}},
    {"clientId": "__OIDC_NATIVE_CLIENT_ID__", "redirectUris": ["http://127.0.0.1/*", "__OIDC_NATIVE_MOBILE_REDIRECT_URI__"],
     "attributes": {"post.logout.redirect.uris": "http://127.0.0.1/kailo/signed-out"}}]}
VALUES = {"PUBLIC_ORIGIN": "http://k.example:1", "OIDC_BROWSER_CLIENT_ID": "browser", "OIDC_NATIVE_CLIENT_ID": "native",
          "OIDC_SERVICE_CLIENT_ID": "core", "OIDC_WORKER_CLIENT_ID": "worker",
          "OIDC_NATIVE_MOBILE_REDIRECT_URI": "kailo://cb", "NATIVE_PAGE_ORIGINS": "http://c.example:2",
          "NATIVE_OIDC_CLIENTS": 'cells=http://c.example:2/auth/kailo/backchannel-logout'}


class FakeKeycloak:
    """In-memory realm admin API covering the paths idp-declarations.py uses."""

    def __init__(self):
        self.clients = {"b": {"id": "b", "clientId": "browser", "redirectUris": ["http://k.example:1/oauth/callback"],
                              "webOrigins": ["+"], "attributes": {}},
                        "n": {"id": "n", "clientId": "native", "redirectUris": ["kailo://cb", "http://127.0.0.1/*"],
                              "attributes": {"pkce.code.challenge.method": "S256"}},
                        "c": {"id": "c", "clientId": "cells", "frontchannelLogout": True, "attributes": {}}}
        self.defaults = {"c": [{"name": "web-origins"}]}
        self.mappers = {"c": []}
        self.profile = {"attributes": [{"name": "username"}]}
        self.users = {"u1": {"id": "u1", "attributes": {}}}
        self.writes = []

    def __call__(self, path, body=None, method=None):
        import copy
        import urllib.parse as up
        method = method or ("POST" if body is not None else "GET")
        if method != "GET":
            self.writes.append((method, path))
        parts = up.urlsplit(path)
        seg = parts.path.strip("/").split("/")
        if seg == ["clients"]:
            cid = up.parse_qs(parts.query)["clientId"][0]
            return [copy.deepcopy(c) for c in self.clients.values() if c["clientId"] == cid]
        if seg == ["client-scopes"]:
            return [{"name": "profile", "id": "sp"}, {"name": "email", "id": "se"}]
        if seg == ["users", "profile"]:
            if method == "PUT":
                self.profile = copy.deepcopy(body)
            return copy.deepcopy(self.profile)
        if seg[0] == "users" and len(seg) == 1:
            first = int(up.parse_qs(parts.query)["first"][0])
            return [copy.deepcopy(u) for u in list(self.users.values())[first:]]
        if seg[0] == "users":
            if method == "PUT":
                self.users[seg[1]] = copy.deepcopy(body)
            return copy.deepcopy(self.users[seg[1]])
        client = self.clients[seg[1]]
        if len(seg) == 2:
            if method == "PUT":
                for k, v in body.items():
                    client[k] = dict(client.get(k) or {}, **v) if k == "attributes" else v
            return copy.deepcopy(client)
        if seg[2] == "default-client-scopes":
            if method == "PUT":
                self.defaults[seg[1]].append({"name": {"sp": "profile", "se": "email"}[seg[3]]})
            return copy.deepcopy(self.defaults[seg[1]])
        if seg[2] == "protocol-mappers":
            if method == "POST":
                self.mappers[seg[1]].append(copy.deepcopy(body))
            return copy.deepcopy(self.mappers[seg[1]])
        raise AssertionError(path)


class IdpDeclarations(unittest.TestCase):
    def test_expected_redirects_come_from_the_template_without_secrets(self):
        wanted = idp.desired_redirects(TEMPLATE, VALUES)
        label, browser = wanted["browser"]
        self.assertEqual(browser["redirectUris"], ["http://k.example:1/oauth/callback"])
        self.assertEqual(browser["attributes"], {"post.logout.redirect.uris": "http://k.example:1/app/"})
        self.assertNotIn("secret", browser)
        self.assertEqual(wanted["native"][1]["attributes"]["post.logout.redirect.uris"], "http://127.0.0.1/kailo/signed-out")
        leaking = {"clients": [dict(TEMPLATE["clients"][0], redirectUris=["__BROWSER_CLIENT_SECRET__"]),
                               TEMPLATE["clients"][1]]}
        with self.assertRaises(idp.Refused):
            idp.desired_redirects(leaking, VALUES)

    def test_redirect_verify_is_read_only_and_sync_converges(self):
        kc = FakeKeycloak()
        wanted = idp.desired_redirects(TEMPLATE, VALUES)
        report = idp.sync_redirects(idp.ReadOnly(kc), wanted, verify=True)
        self.assertEqual(len(report["problems"]), 2)
        self.assertEqual(kc.writes, [])
        self.assertNotIn("browser", json.dumps(report["problems"], ensure_ascii=False))
        self.assertEqual(idp.sync_redirects(kc, wanted, verify=False)["changed"], 2)
        self.assertEqual(idp.sync_redirects(idp.ReadOnly(kc), wanted, verify=True)["problems"], [])
        self.assertEqual(kc.clients["n"]["attributes"]["pkce.code.challenge.method"], "S256")

    def test_native_profiles_declare_verify_and_refuse_divergent_mapper(self):
        kc = FakeKeycloak()
        before = idp.native_profiles(idp.ReadOnly(kc), VALUES, "verify")
        self.assertEqual(before["nativeClientProfiles"], "DRIFTED")
        self.assertEqual(kc.writes, [])
        with self.assertRaises(idp.Refused):
            idp.native_profiles(kc, VALUES, "users-only")
        self.assertEqual(kc.writes, [], "a drifted configuration is refused before any user write")
        declared = idp.native_profiles(kc, VALUES, "declare")
        self.assertEqual(declared["nativeClientProfiles"], "DECLARED")
        self.assertEqual(kc.users["u1"]["attributes"]["picture"], ["http://k.example:1/api/v1/identity/avatars/u1"])
        self.assertEqual(idp.native_profiles(idp.ReadOnly(kc), VALUES, "verify")["problems"], [])
        kc.users["u2"] = {"id": "u2", "attributes": {}}
        self.assertEqual(idp.native_profiles(idp.ReadOnly(kc), VALUES, "verify")["missing"], 1)
        self.assertEqual(idp.native_profiles(kc, VALUES, "users-only")["written"], 1)
        kc.mappers["c"][0]["config"]["claim.name"] = "avatar"
        with self.assertRaises(idp.Refused):
            idp.native_profiles(kc, VALUES, "declare")

    def test_empty_declaration_is_undeclared_without_network_and_invalid_is_refused(self):
        self.assertEqual(idp.declared_clients(dict(VALUES, NATIVE_OIDC_CLIENTS="")), [])
        for raw in ("{", "[]",
                    '[{"clientId":"browser","backchannelLogoutUrl":"http://c.example:2/auth/kailo/backchannel-logout"}]',
                    '[{"clientId":"x","backchannelLogoutUrl":"http://other.example/auth/kailo/backchannel-logout"}]',
                    # 07 §4.7.5: only the fixed receiver paths
                    '[{"clientId":"x","backchannelLogoutUrl":"http://c.example:2/x"}]',
                    '[{"clientId":"x","backchannelLogoutUrl":"http://c.example:2/oauth/backchannel-logout?a=1"}]'):
            with self.assertRaises(idp.Refused):
                idp.declared_clients(dict(VALUES, NATIVE_OIDC_CLIENTS=raw))
        env = {k: v for k, v in dict(VALUES, NATIVE_OIDC_CLIENTS="", OIDC_ISSUER="http://k.example:3/realms/r",
                                     OIDC_REALM="r", KEYCLOAK_ADMIN_USER="admin").items()}
        saved = dict(os.environ)
        try:
            os.environ.update(env, KAILO_RUNTIME_DIR="/nonexistent-runtime")
            original = idp.Admin
            idp.Admin = lambda *a: self.fail("an undeclared run must not contact the IdP")
            self.assertEqual(idp.main(["native-profiles", "--verify"])["nativeClientProfiles"], "UNDECLARED")
            self.assertEqual(idp.main(["native-profiles"])["nativeClientProfiles"], "UNDECLARED")
        finally:
            idp.Admin = original
            os.environ.clear()
            os.environ.update(saved)

    def test_existing_client_back_channel_attributes_converge_and_drift_is_reported(self):
        # 07 §4.7.5: the four logout attributes follow the declaration on an existing client.
        kc = FakeKeycloak()
        idp.native_profiles(kc, VALUES, "declare")
        cells = kc.clients["c"]
        self.assertIs(cells["frontchannelLogout"], False)
        self.assertEqual({k: cells["attributes"][k] for k in ("backchannel.logout.url",
                          "backchannel.logout.session.required", "backchannel.logout.revoke.offline.tokens")},
                         {"backchannel.logout.url": "http://c.example:2/auth/kailo/backchannel-logout",
                          "backchannel.logout.session.required": "true",
                          "backchannel.logout.revoke.offline.tokens": "false"})
        kc.writes.clear()
        self.assertEqual(idp.native_profiles(kc, VALUES, "declare")["nativeClientProfiles"], "DECLARED")
        self.assertEqual(kc.writes, [], "a converged client is not written again")
        for key, drifted in (("frontchannelLogout", True),
                             ("backchannel.logout.url", "http://c.example:2/elsewhere"),
                             ("backchannel.logout.session.required", "false"),
                             ("backchannel.logout.revoke.offline.tokens", "true")):
            if key == "frontchannelLogout":
                cells[key] = drifted
            else:
                cells["attributes"][key] = drifted
            report = idp.native_profiles(idp.ReadOnly(kc), VALUES, "verify")
            self.assertEqual(report["nativeClientProfiles"], "DRIFTED", key)
            self.assertNotIn("elsewhere", json.dumps(report, ensure_ascii=False))
            idp.native_profiles(kc, VALUES, "declare")
            self.assertEqual(idp.native_profiles(idp.ReadOnly(kc), VALUES, "verify")["problems"], [], key)
        del kc.clients["c"]
        with self.assertRaises(idp.Refused):
            idp.native_profiles(kc, VALUES, "declare")
        self.assertFalse(any(path == "/clients" for method, path in kc.writes if method == "POST"),
                         "a missing component client is never created")

    def test_read_only_wrapper_refuses_writes(self):
        with self.assertRaises(idp.Refused):
            idp.ReadOnly(FakeKeycloak())("/users/profile", {}, "PUT")


SCOPE_TEMPLATE = {"clients": [{"clientId": "__OIDC_SERVICE_CLIENT_ID__", "optionalClientScopes": ["__CORE_MCP_AUDIENCE__"]}]}
SCOPE_VALUES = dict(VALUES, CORE_MCP_AUDIENCE="kailo-core-mcp", AGENTGATEWAY_ADMIN_AUDIENCE="gateway-admin",
                    OIDC_NATIVE_AUDIENCE="native-aud")


class FakeScopeRealm:
    """In-memory realm admin API for the DD-137 service-scope declaration."""

    def __init__(self):
        self.scopes = {"sp": {"id": "sp", "name": "profile", "protocol": "openid-connect"}}
        self.scope_mappers = {"sp": []}
        self.clients = {cid: {"id": cid, "clientId": name} for cid, name in
                        (("c", "core"), ("w", "worker"), ("b", "browser"), ("n", "native"))}
        self.attached = {cid: {"default-client-scopes": [], "optional-client-scopes": []} for cid in self.clients}
        self.realm_defaults = {"default-default-client-scopes": [{"name": "profile"}], "default-optional-client-scopes": []}
        self.writes = []
        self.lose_next_create = False

    def __call__(self, path, body=None, method=None):
        import copy
        import urllib.error
        import urllib.parse as up
        method = method or ("POST" if body is not None else "GET")
        if method != "GET":
            self.writes.append((method, path))
        parts = up.urlsplit(path)
        seg = parts.path.strip("/").split("/")
        if seg[0] in self.realm_defaults:
            return copy.deepcopy(self.realm_defaults[seg[0]])
        if seg == ["client-scopes"]:
            if method == "POST":
                sid = "s%d" % len(self.scopes)
                self.scopes[sid] = dict(copy.deepcopy(body), id=sid)
                self.scope_mappers[sid] = []
                if self.lose_next_create:
                    self.lose_next_create = False
                    raise urllib.error.URLError("response lost")
                return None
            return copy.deepcopy(list(self.scopes.values()))
        if seg[0] == "client-scopes":
            if method == "POST":
                self.scope_mappers[seg[1]].append(copy.deepcopy(body))
                return None
            return copy.deepcopy(self.scope_mappers[seg[1]])
        if seg == ["clients"]:
            cid = up.parse_qs(parts.query)["clientId"][0]
            return [copy.deepcopy(c) for c in self.clients.values() if c["clientId"] == cid]
        kind = seg[2]
        if method == "PUT":
            self.attached[seg[1]][kind].append({"name": self.scopes[seg[3]]["name"]})
            return None
        return copy.deepcopy(self.attached[seg[1]][kind])


class ServiceScopeDeclaration(unittest.TestCase):
    def declare(self, kc, verify=False, values=SCOPE_VALUES):
        scope, mapper = idp.core_mcp_scope(SCOPE_TEMPLATE, values)
        return idp.service_scopes(idp.ReadOnly(kc) if verify else kc, values, scope, mapper, verify)

    def test_verify_reports_drift_without_writing_then_declare_converges_idempotently(self):
        kc = FakeScopeRealm()
        before = self.declare(kc, verify=True)
        self.assertEqual(before["serviceScopes"], "DRIFTED")
        self.assertEqual(kc.writes, [])
        self.assertNotIn("kailo-core-mcp", json.dumps(before, ensure_ascii=False))
        declared = self.declare(kc)
        self.assertEqual((declared["serviceScopes"], declared["changed"]), ("DECLARED", 3))
        scope = [s for s in kc.scopes.values() if s["name"] == "kailo-core-mcp"]
        self.assertEqual(len(scope), 1)
        self.assertEqual(kc.scope_mappers[scope[0]["id"]][0]["config"]["included.custom.audience"], "kailo-core-mcp")
        self.assertEqual(kc.attached["c"]["optional-client-scopes"], [{"name": "kailo-core-mcp"}])
        self.assertEqual(kc.attached["c"]["default-client-scopes"], [])
        writes = len(kc.writes)
        self.assertEqual(self.declare(kc)["changed"], 0)
        self.assertEqual(len(kc.writes), writes, "a converged realm is read only")
        self.assertEqual(self.declare(kc, verify=True), dict(serviceScopes="DECLARED", changed=0, problems=[]))

    def test_lost_create_response_is_settled_by_readback_not_a_second_post(self):
        kc = FakeScopeRealm()
        kc.lose_next_create = True
        self.assertEqual(self.declare(kc)["serviceScopes"], "DECLARED")
        self.assertEqual(sum(1 for m, p in kc.writes if m == "POST" and p == "/client-scopes"), 1)

    def test_divergent_or_misattached_scope_is_refused_not_overwritten(self):
        kc = FakeScopeRealm()
        self.declare(kc)
        sid = next(s["id"] for s in kc.scopes.values() if s["name"] == "kailo-core-mcp")
        kc.scope_mappers[sid][0]["config"]["included.custom.audience"] = "gateway-admin"
        writes = len(kc.writes)
        with self.assertRaises(idp.Refused):
            self.declare(kc)
        self.assertEqual(len(kc.writes), writes)
        kc.scope_mappers[sid][0]["config"]["included.custom.audience"] = "kailo-core-mcp"
        kc.scope_mappers[sid].append({"name": "extra", "protocol": "openid-connect", "protocolMapper": "x", "config": {}})
        with self.assertRaises(idp.Refused):
            self.declare(kc)
        kc.scope_mappers[sid].pop()
        for holder in (kc.attached["w"]["optional-client-scopes"], kc.attached["c"]["default-client-scopes"],
                       kc.realm_defaults["default-optional-client-scopes"]):
            holder.append({"name": "kailo-core-mcp"})
            with self.assertRaises(idp.Refused):
                self.declare(kc)
            holder.pop()
        self.assertEqual(self.declare(kc, verify=True)["problems"], [])

    def test_scope_definition_comes_from_the_template_link_and_a_distinct_audience(self):
        with self.assertRaises(idp.Refused):
            idp.core_mcp_scope({"clients": [{"clientId": "__OIDC_SERVICE_CLIENT_ID__"}]}, SCOPE_VALUES)
        for audience in ("", "two words", "back\\slash", "gateway-admin", "core", "worker", "native-aud"):
            with self.assertRaises(idp.Refused):
                idp.core_mcp_scope(SCOPE_TEMPLATE, dict(SCOPE_VALUES, CORE_MCP_AUDIENCE=audience))
        with open(os.path.join(os.path.dirname(__file__), "..", "..", "deploy", "local", "identity-provider",
                               "realm.json"), encoding="utf-8") as stream:
            template = json.load(stream)
        scope, mapper = idp.core_mcp_scope(template, SCOPE_VALUES)
        self.assertEqual(scope["name"], "kailo-core-mcp")
        self.assertEqual(mapper["protocolMapper"], "oidc-audience-mapper")
        self.assertIn("CORE_MCP_AUDIENCE", idp.INPUT_ENV)


class DeclaredEnvPreview(unittest.TestCase):
    """backup 先于 deploy：compose 必须按声明后的 .env 渲染（新的 ${NAME:?} 键尚未落盘）。"""

    def release(self, runtime, to_set, to_unset=()):
        r = node.Release.__new__(node.Release)
        r.runtime, r.decl, r.tree = runtime, dict(overlays=[]), "/tree"

        class Model:
            @staticmethod
            def env_declaration(decl):
                return dict(to_set), list(to_unset)
        r.model = Model
        return r

    def test_preview_carries_declared_keys_and_is_removed(self):
        with tempfile.TemporaryDirectory() as runtime:
            with open(os.path.join(runtime, ".env"), "w") as stream:
                stream.write("A=1\nOLD=x\n")
            r = self.release(runtime, {"NEW": "2", "A": "1"}, ["OLD"])
            self.assertIn(os.path.join(runtime, ".env"), r.compose_argv())
            with r.declared_env_preview():
                argv = r.compose_argv()
                preview = argv[argv.index("--env-file") + 1]
                self.assertNotEqual(preview, os.path.join(runtime, ".env"))
                self.assertEqual(os.path.dirname(preview), runtime)
                self.assertEqual(os.stat(preview).st_mode & 0o777, 0o600)
                with open(preview) as stream:
                    self.assertEqual(stream.read().split("\n"), ["A=1", "NEW=2", ""])
            self.assertFalse(os.path.exists(preview))
            self.assertIn(os.path.join(runtime, ".env"), r.compose_argv())
            with open(os.path.join(runtime, ".env")) as stream:
                self.assertEqual(stream.read(), "A=1\nOLD=x\n")

    def test_no_declared_change_uses_the_runtime_env(self):
        with tempfile.TemporaryDirectory() as runtime:
            with open(os.path.join(runtime, ".env"), "w") as stream:
                stream.write("A=1\n")
            r = self.release(runtime, {"A": "1"})
            with r.declared_env_preview():
                self.assertIn(os.path.join(runtime, ".env"), r.compose_argv())
            self.assertEqual(sorted(os.listdir(runtime)), [".env"])


if __name__ == "__main__":
    unittest.main()
