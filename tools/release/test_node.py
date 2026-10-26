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
            r.retention = lambda: events.append("retention") or dict(deleted=[])
            saved = node.containers, node.running_containers, node.container_file
            node.containers, node.running_containers, node.container_file = \
                (lambda project: live), (lambda: {}), (lambda cid, target: None)
            try:
                journal = r.deploy()
            finally:
                node.containers, node.running_containers, node.container_file = saved
        self.assertEqual(events, ["pull worker", "oneoffs", "up peer", "up keycloak", "wait keycloak", "idp",
                                  "up worker", "up sidecar", "retention"])
        self.assertEqual(journal["retention"], dict(deleted=[]))
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
                       "COMPONENT_CONFORMANCE_DIR": "${KAILO_RUNTIME_DIR}/data/conformance",
                       "COMPONENT_CONFORMANCE_WORKER_DIR": "${KAILO_RUNTIME_DIR}/data/conformance-worker"},
               "unset": ["COMPONENT_CONFORMANCE_ENVIRONMENT_FILE", "COMPONENT_CONFORMANCE_FIXTURE_FILE",
                         "COMPONENT_CONFORMANCE_IDENTITY_FILE"]}
        value = {"units": {}, "services": {"core-bff": {"command": ["./start-core.sh", "--no-build"]}},
                 "migrations": {}, "order": {}, "node": {}, "env": env, "operated": ["protocol-peer-reference"],
                 "delivery": {"protocol_peers": {"directory": os.path.join(self.tmp.name, "directory.json"),
                                                 "conformance": os.path.join(self.tmp.name, "conformance.json"),
                                                 "runtime": "data/protocol-peers", "candidates": "data/conformance",
                                                 "worker": "data/conformance-worker", "restart": "core-bff"}}}
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
        second = self.model.peer_delivery(self.decl(), self.services)
        self.assertNotEqual(second["digest"], first["digest"])
        # DD-136(2): content changes are read per use; only the mount shape restarts Core.
        self.assertEqual(second["shape"], first["shape"])
        decl = self.decl()
        decl["delivery"]["protocol_peers"]["candidates"] = "data/conformance-2"
        decl["env"]["set"]["COMPONENT_CONFORMANCE_DIR"] = "${KAILO_RUNTIME_DIR}/data/conformance-2"
        self.assertNotEqual(self.model.peer_delivery(decl, self.services)["shape"], first["shape"])

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
        decl["env"]["unset"] = ["COMPONENT_CONFORMANCE_FIXTURE_FILE", "COMPONENT_CONFORMANCE_IDENTITY_FILE"]
        self.refused("env.unset", decl)
        decl = self.decl()
        decl["env"]["set"]["COMPONENT_CONFORMANCE_DIR"] = "${KAILO_RUNTIME_DIR}/data/protocol-peers"
        self.refused("COMPONENT_CONFORMANCE_DIR", decl)
        decl = self.decl()
        decl["env"]["set"].pop("COMPONENT_CONFORMANCE_WORKER_DIR")
        self.refused("COMPONENT_CONFORMANCE_WORKER_DIR", decl)
        decl = self.decl()
        decl["delivery"]["protocol_peers"]["runtime"] = "../outside"
        self.refused("runtime", decl)
        for key, value in (("candidates", "data/protocol-peers"), ("worker", "data/conformance/worker")):
            decl = self.decl()
            decl["delivery"]["protocol_peers"][key] = value
            self.refused("互不包含", decl)
        decl = self.decl()
        decl["delivery"]["protocol_peers"].pop("worker")
        self.refused("delivery.protocol_peers", decl)
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
            digest = release.delivery["conformance"]["artifactDigest"]
            candidates = os.path.join(release.runtime, release.delivery["candidates"])
            worker = os.path.join(release.runtime, release.delivery["worker"])
            # A REMOTE_ADAPTER candidate of the component entry, a stale peer
            # candidate of an earlier declaration and the single-candidate file.
            component = os.path.join(candidates, "b" * 64)
            stale = os.path.join(candidates, "c" * 64)
            for path in (component, stale):
                os.makedirs(path)
            for name in ("environment.json", "fixture.json", "identity.json"):
                with open(os.path.join(component, name), "w", encoding="utf-8") as stream:
                    json.dump({"artifactDigest": "b" * 64, "adapterBaseUrl": "http://x/"}, stream)
            with open(os.path.join(stale, "environment.json"), "w", encoding="utf-8") as stream:
                json.dump({"artifactDigest": "c" * 64, "mcpUrl": "http://old/mcp"}, stream)
            with open(os.path.join(folder, model.LEGACY_PEER_CONFORMANCE_FILE), "w", encoding="utf-8") as stream:
                stream.write("{}")
            self.assertEqual(sorted(release.write_deliveries()),
                             sorted([model.PEER_DIRECTORY_FILE, f"conformance/{digest}", f"-conformance/{'c' * 64}",
                                     f"-{model.LEGACY_PEER_CONFORMANCE_FILE}"]))
            self.assertEqual(release.write_deliveries(), [])
            self.assertEqual(sorted(os.listdir(candidates)), sorted([digest, "b" * 64]))
            self.assertEqual(sorted(os.listdir(component)), ["environment.json", "fixture.json", "identity.json"])
            with open(os.path.join(folder, model.PEER_DIRECTORY_FILE), encoding="utf-8") as stream:
                directory = json.load(stream)
            self.assertEqual(directory["adapters"], [{"adapterServiceRef": "knowledge-adapter"}])
            self.assertEqual(directory["protocolPeers"], release.delivery["peers"])
            with open(os.path.join(candidates, digest, "environment.json"), encoding="utf-8") as stream:
                self.assertEqual(json.load(stream), release.delivery["conformance"])
            for path in (os.path.join(folder, model.PEER_DIRECTORY_FILE), os.path.join(candidates, digest, "environment.json")):
                self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o644)
            for path, mode in ((candidates, 0o755), (os.path.join(candidates, digest), 0o755), (worker, 0o700)):
                self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), mode)
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
        if "directory" in argv[1]:
            body = {"directoryClients": "DECLARED", "clients": 3, "changed": 0, "problems": ["x"] * code}
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
        self.assertEqual(plan, dict(state="never", native_clients_declared=True, directory_clients_declared=False))
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


DIRECTORY_VALUES = dict(VALUES, OIDC_REALM="Kailo", OIDC_NATIVE_AUDIENCE="native-aud",
                        COMPONENT_DIRECTORY_CLIENTS="file-storage=cells-dir,knowledge=knowledge-dir,data-query=wren-dir")


class FakeDirectoryRealm:
    """In-memory realm admin API for the DD-133(4) directory-client declaration."""

    def __init__(self):
        self.clients, self.mappers, self.secrets, self.accounts, self.roles = {}, {}, {}, {}, {}
        self.writes, self.lose_next_create = [], False

    def add(self, body, generated="idp-generated-secret"):
        import copy
        cid = "id-%d" % len(self.clients)
        client = {k: copy.deepcopy(v) for k, v in body.items() if k not in ("secret", "protocolMappers")}
        client["id"] = cid
        self.clients[cid] = client
        self.mappers[cid] = copy.deepcopy(body.get("protocolMappers") or [])
        self.secrets[cid] = body.get("secret") or generated
        self.accounts[cid] = "sa-" + cid
        self.roles["sa-" + cid] = {"realmMappings": [{"name": "default-roles-kailo"}]}
        return cid

    def __call__(self, path, body=None, method=None):
        import copy
        import urllib.error
        import urllib.parse as up
        method = method or ("POST" if body is not None else "GET")
        if method != "GET":
            self.writes.append((method, path))
        parts = up.urlsplit(path)
        seg = parts.path.strip("/").split("/")
        if seg == ["clients"]:
            if method == "POST":
                self.add(body)
                if self.lose_next_create:
                    self.lose_next_create = False
                    raise urllib.error.URLError("response lost")
                return None
            wanted = up.parse_qs(parts.query)["clientId"][0]
            return [copy.deepcopy(c) for c in self.clients.values() if c["clientId"] == wanted]
        if seg[0] == "users":
            return copy.deepcopy(self.roles[seg[1]])
        cid = seg[1]
        if len(seg) == 2:
            return copy.deepcopy(self.clients[cid])
        if seg[2] == "protocol-mappers":
            if method == "POST":
                self.mappers[cid].append(copy.deepcopy(body))
                return None
            return copy.deepcopy(self.mappers[cid])
        if seg[2] == "service-account-user":
            return {"id": self.accounts[cid]}
        if seg[2] == "client-secret":
            return {"type": "secret", "value": self.secrets[cid]}
        raise AssertionError(path)


class DirectoryClientDeclaration(unittest.TestCase):
    """DD-133(4), .design/07 §4.7.4: the release declares each component's member-directory client."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runtime = self.tmp.name
        os.mkdir(os.path.join(self.runtime, "secrets"), 0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def run_step(self, kc, verify=False, values=DIRECTORY_VALUES):
        return idp.directory_clients(idp.ReadOnly(kc) if verify else kc, values, self.runtime, verify)

    def secret_file(self, component):
        return os.path.join(self.runtime, "secrets", "component-directory", component, "client_secret")

    def by_client(self, kc, client_id):
        return next(c for c in kc.clients.values() if c["clientId"] == client_id)

    def assert_no_values(self, kc, report):
        text = json.dumps(report, ensure_ascii=False)
        for value in list(kc.secrets.values()) + ["cells-dir", "knowledge-dir", "wren-dir", "core"]:
            self.assertNotIn(value, text)

    def test_declarations_are_validated_before_any_network(self):
        self.assertEqual(idp.declared_directory_clients(dict(DIRECTORY_VALUES, COMPONENT_DIRECTORY_CLIENTS="")), [])
        self.assertEqual(idp.declared_directory_clients(DIRECTORY_VALUES),
                         [("file-storage", "cells-dir"), ("knowledge", "knowledge-dir"), ("data-query", "wren-dir")])
        for raw in ("cells-dir", "files=cells-dir", "knowledge=a,knowledge=b", "knowledge=x,data-query=x",
                    "knowledge=core", "knowledge=worker", "knowledge=browser", "knowledge=native",
                    "knowledge=cells",  # a component browser client (NATIVE_OIDC_CLIENTS) is not a directory client
                    "knowledge=two words", "knowledge=a/b", "knowledge="):
            with self.assertRaises(idp.Refused, msg=raw):
                idp.declared_directory_clients(dict(DIRECTORY_VALUES, COMPONENT_DIRECTORY_CLIENTS=raw))
        saved = dict(os.environ)
        original = idp.Admin
        try:
            os.environ.update({k: v for k, v in DIRECTORY_VALUES.items() if k != "COMPONENT_DIRECTORY_CLIENTS"},
                              COMPONENT_DIRECTORY_CLIENTS="", OIDC_ISSUER="http://k.example:3/realms/r",
                              KEYCLOAK_ADMIN_USER="admin", KAILO_RUNTIME_DIR=self.runtime)
            idp.Admin = lambda *a: self.fail("an undeclared run must not contact the IdP")
            for argv in (["directory-clients"], ["directory-clients", "--verify"]):
                self.assertEqual(idp.main(argv)["directoryClients"], "UNDECLARED")
            os.environ["COMPONENT_DIRECTORY_CLIENTS"] = "unknown=x"
            with self.assertRaises(idp.Refused):
                idp.main(["directory-clients"])
            with self.assertRaises(idp.Refused):
                idp.main(["directory-clients", "--users-only"])
        finally:
            idp.Admin = original
            os.environ.clear()
            os.environ.update(saved)
        self.assertFalse(os.path.exists(os.path.join(self.runtime, "secrets", "component-directory")))

    def test_verify_reports_missing_clients_without_writing(self):
        kc = FakeDirectoryRealm()
        report = self.run_step(kc, verify=True)
        self.assertEqual((report["directoryClients"], len(report["problems"])), ("DRIFTED", 3))
        self.assertEqual(kc.writes, [])
        self.assertFalse(os.path.exists(os.path.join(self.runtime, "secrets", "component-directory")))
        self.assert_no_values(kc, report)

    def test_declare_creates_service_account_only_clients_and_delivers_the_idp_secret(self):
        kc = FakeDirectoryRealm()
        report = self.run_step(kc)
        self.assertEqual((report["directoryClients"], report["clients"], report["problems"]), ("DECLARED", 3, []))
        for component, client_id in (("file-storage", "cells-dir"), ("knowledge", "knowledge-dir"),
                                     ("data-query", "wren-dir")):
            client = self.by_client(kc, client_id)
            self.assertIs(client["serviceAccountsEnabled"], True)
            self.assertIs(client["publicClient"], False)
            for flow in ("standardFlowEnabled", "implicitFlowEnabled", "directAccessGrantsEnabled"):
                self.assertIs(client[flow], False, flow)
            self.assertEqual((client["redirectUris"], client["webOrigins"]), ([], []))
            self.assertIs(client["fullScopeAllowed"], False)
            [mapper] = kc.mappers[client["id"]]
            self.assertEqual(mapper["protocolMapper"], "oidc-audience-mapper")
            self.assertEqual(mapper["config"]["included.custom.audience"], "core")
            self.assertEqual(mapper["config"]["access.token.claim"], "true")
            path = self.secret_file(component)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            self.assertEqual(os.stat(os.path.dirname(path)).st_mode & 0o777, 0o700)
            with open(path, encoding="utf-8") as stream:
                self.assertEqual(stream.read().strip(), kc.secrets[client["id"]])
        self.assertEqual(len(set(kc.secrets.values())), 3, "every client has its own credential")
        self.assert_no_values(kc, report)
        kc.writes.clear()
        again = self.run_step(kc)
        self.assertEqual((again["changed"], kc.writes), (0, []), "a converged realm is only read")
        self.assertEqual(self.run_step(kc, verify=True), dict(directoryClients="DECLARED", clients=3, changed=0,
                                                              problems=[]))

    def test_lost_create_response_is_settled_by_readback_not_a_second_post(self):
        kc = FakeDirectoryRealm()
        kc.lose_next_create = True
        self.assertEqual(self.run_step(kc)["directoryClients"], "DECLARED")
        self.assertEqual(sum(1 for m, p in kc.writes if m == "POST" and p == "/clients"), 3)

    def test_secret_file_follows_the_idp_and_drift_is_reported(self):
        kc = FakeDirectoryRealm()
        # A client created out of band (say by an operator) keeps its IdP credential; the file is written from it.
        kc.add(idp.directory_client("knowledge-dir", "knowledge", "core", None), generated="operator-made")
        self.run_step(kc)
        path = self.secret_file("knowledge")
        with open(path, encoding="utf-8") as stream:
            self.assertEqual(stream.read().strip(), "operator-made")
        os.unlink(path)
        report = self.run_step(kc, verify=True)
        self.assertEqual((report["directoryClients"], len(report["problems"])), ("DRIFTED", 1))
        self.assertFalse(os.path.exists(path))
        self.assert_no_values(kc, report)
        self.run_step(kc)
        with open(path, "w", encoding="utf-8") as stream:
            stream.write("stale\n")
        self.assertEqual(len(self.run_step(kc, verify=True)["problems"]), 1)
        self.run_step(kc)
        with open(path, encoding="utf-8") as stream:
            self.assertEqual(stream.read().strip(), "operator-made", "the IdP credential is authoritative")
        os.chmod(path, 0o644)
        with self.assertRaises(idp.Refused):
            self.run_step(kc, verify=True)

    def test_divergent_existing_client_is_refused_not_overwritten(self):
        cases = (("standardFlowEnabled", True), ("publicClient", True), ("directAccessGrantsEnabled", True),
                 ("serviceAccountsEnabled", False), ("redirectUris", ["http://evil.example/*"]))
        for key, value in cases:
            kc = FakeDirectoryRealm()
            body = idp.directory_client("cells-dir", "file-storage", "core", "s")
            body[key] = value
            kc.add(body)
            with self.assertRaises(idp.Refused, msg=key):
                self.run_step(kc)
            self.assertEqual(kc.writes, [], key)
        for mutate in (lambda m: m[0]["config"].update({"included.custom.audience": "worker"}),
                       lambda m: m.append({"name": "extra", "protocol": "openid-connect",
                                           "protocolMapper": "oidc-hardcoded-claim-mapper", "config": {}})):
            kc = FakeDirectoryRealm()
            cid = kc.add(idp.directory_client("cells-dir", "file-storage", "core", "s"))
            mutate(kc.mappers[cid])
            with self.assertRaises(idp.Refused):
                self.run_step(kc)
        kc = FakeDirectoryRealm()
        cid = kc.add(idp.directory_client("cells-dir", "file-storage", "core", "s"))
        kc.roles["sa-" + cid]["realmMappings"].append({"name": "admin"})
        with self.assertRaises(idp.Refused):
            self.run_step(kc)

    def test_release_declares_and_verifies_the_three_directory_clients(self):
        _mspec = importlib.util.spec_from_file_location("release_model_dir", os.path.join(os.path.dirname(__file__),
                                                                                           "model.py"))
        model = importlib.util.module_from_spec(_mspec)
        _mspec.loader.exec_module(model)
        spec = model.idp_declaration()
        self.assertIn(["./bootstrap.sh", "--declare-directory-clients"], spec["apply"])
        self.assertIn(["./bootstrap.sh", "--verify-directory-clients"], spec["verify"])
        self.assertIn("COMPONENT_DIRECTORY_CLIENTS", idp.INPUT_ENV)
        to_set, _ = model.env_declaration()
        production = dict(DIRECTORY_VALUES, COMPONENT_DIRECTORY_CLIENTS=to_set["COMPONENT_DIRECTORY_CLIENTS"],
                          NATIVE_OIDC_CLIENTS=to_set["NATIVE_OIDC_CLIENTS"])
        self.assertEqual([c for c, _ in idp.declared_directory_clients(production)],
                         ["file-storage", "knowledge", "data-query"])
        with open(os.path.join(os.path.dirname(__file__), "..", "..", "deploy", "local", "bootstrap.sh"),
                  encoding="utf-8") as stream:
            text = stream.read()
        for flag in ("--declare-directory-clients", "--verify-directory-clients"):
            self.assertIn(f"'{flag}'", text)

    def test_step_reports_directory_status_without_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, node.IDP_STATE)
            spec = dict(SPEC, apply=SPEC["apply"] + [["./bootstrap.sh", "--declare-directory-clients"]],
                        verify=SPEC["verify"] + [["./bootstrap.sh", "--verify-directory-clients"]])
            env = dict(ENV, COMPONENT_DIRECTORY_CLIENTS=["knowledge=sentinel-directory"])
            keys = KEYS + ["COMPONENT_DIRECTORY_CLIENTS"]
            step = node.IdpStep(spec, node.idp_digest(FILES, env, keys), env, state, FakeRunner())
            self.assertTrue(step.plan()["directory_clients_declared"])
            applied = step.apply("c" * 40)
            self.assertIn("--declare-directory-clients", [c["command"] for c in applied["commands"]])
            self.assertIs(node.read_json(state)["directory_clients_declared"], True)
            verified = step.verify()
            self.assertEqual((verified["directory_clients"], verified["problems"]), ("DECLARED", []))
            self.assertNotIn("sentinel-directory", json.dumps([applied, verified, node.read_json(state)]))
            failing = node.IdpStep(spec, node.idp_digest(FILES, env, keys), env, state,
                                   FakeRunner(fail={"--verify-directory-clients": 1}))
            self.assertEqual(len(failing.verify()["problems"]), 1)
            changed = node.idp_digest(FILES, dict(env, COMPONENT_DIRECTORY_CLIENTS=["knowledge=other"]), keys)
            self.assertNotEqual(changed, step.digest, "the declaration is part of the configuration digest")


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


def _orchestrator():
    spec = importlib.util.spec_from_file_location("release_orchestrator", os.path.join(os.path.dirname(__file__), "orchestrator.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FirstBuild(unittest.TestCase):
    """An upstream artifact recorded as none is a rebuild unit once CI registers its build target
    (document-editor stayed "blocked" and was never built by the release entry)."""

    def setUp(self):
        self.orch = _orchestrator()
        self.current = "sha256:" + "1" * 64

    def unit(self, name, artifact="none", blocked=None):
        art = dict(name=name, kind="image", source_digest=artifact if artifact == "none" else self.current,
                   artifact_digest=artifact)
        if blocked:
            art["blocked"] = blocked
        return self.orch.model.Unit(name, "upstream", [name], record=f"{name}/fork/upstream.yaml", artifact=art)

    def test_unrecorded_artifact_with_a_ci_target_is_a_first_build(self):
        for state, blocked in (("unbuilt", None), ("blocked", "deployment receipt still open")):
            with self.subTest(state=state):
                entry = self.orch.upstream_entry(self.unit("document-editor", blocked=blocked), state, "none",
                                                 self.current, {"document-editor", "web-client"})
                self.assertEqual((entry["state"], entry["first_build"], entry["key"]), ("stale", True, self.current))
                self.assertEqual(entry["blocked"], bool(blocked))

    def test_unrecorded_artifact_without_a_ci_target_is_kept(self):
        for state in ("unbuilt", "blocked"):
            entry = self.orch.upstream_entry(self.unit("mobile-client", blocked="no build entry"), state, "none",
                                             self.current, {"document-editor"})
            self.assertEqual((entry["state"], entry["first_build"]), (state, False))

    def test_recorded_states_are_unchanged(self):
        unit = self.unit("document-editor", artifact="sha256:" + "2" * 64)
        for state in ("current", "stale"):
            entry = self.orch.upstream_entry(unit, state, self.current, self.current, {"document-editor"})
            self.assertEqual((entry["state"], entry["first_build"]), (state, False))

    def test_first_build_has_no_old_digest_to_trace(self):
        self.assertIsNone(self.orch.recorded_artifact(self.unit("document-editor")))
        digest = "sha256:" + "2" * 64
        self.assertEqual(self.orch.recorded_artifact(self.unit("document-editor", artifact=digest)), digest)

    def test_node_reports_registered_build_targets(self):
        self.assertEqual(node.build_targets({"build_targets": {"web-client": {}, "document-editor": {}}}),
                         ["document-editor", "web-client"])
        self.assertEqual(node.build_targets({}), [])
        with self.assertRaises(node.NodeError):
            node.build_targets({"build_targets": "document-editor"})


C = {k: k * 40 for k in "abcdefgh"}
HOUR = 3600
NOW = 1_800_000_000


def policy(**over):
    value = dict(node.RETENTION_DEFAULTS)
    value.update(over)
    return value


class RetentionDecision(unittest.TestCase):
    def test_each_keep_rule_and_the_rest_is_deleted_oldest_first(self):
        trees = {C["a"]: NOW - 90 * HOUR, C["b"]: NOW - 80 * HOUR, C["c"]: NOW - 70 * HOUR, C["d"]: NOW - 60 * HOUR,
                 C["e"]: NOW - 50 * HOUR, C["f"]: NOW - 1 * HOUR, C["g"]: NOW - 40 * HOUR, C["h"]: NOW - 30 * HOUR}
        releases = [dict(commit=C["a"], state="SUCCEEDED", started_at=10, finished_at=11),   # 当前 pin，但不在最近 1 次
                    dict(commit=C["b"], state="FAILED", started_at=20, finished_at=21)]
        got = node.retention_decision(trees, now=NOW, policy=policy(keep_releases=1),
                                      references={C["c"]: ["容器 openbao 的挂载"]}, releases=releases,
                                      active={C["d"]}, main=C["e"], keep=[C["g"]])
        self.assertEqual(got["keep"][C["a"]], ["当前 pin（最近一次成功发布）"])
        self.assertIn("最近 1 次发布之一（第 1 新）", got["keep"][C["b"]])
        self.assertEqual(got["keep"][C["c"]], ["容器 openbao 的挂载"])
        self.assertEqual(got["keep"][C["d"]], ["CI 队列中未结束的任务"])
        self.assertEqual(got["keep"][C["e"]], ["origin/main"])
        self.assertEqual(got["keep"][C["f"]], ["2 小时内活动"])
        self.assertEqual(got["keep"][C["g"]], ["本次发布"])
        self.assertEqual(got["delete"], [C["h"]])

    def test_recent_releases_count_and_missing_trees_are_ignored(self):
        trees = {C[k]: NOW - 100 * HOUR for k in "abcd"}
        releases = [dict(commit=C[k], state="SUCCEEDED", started_at=i, finished_at=i)
                    for i, k in enumerate("abcd")] + [dict(commit=C["h"], state="SUCCEEDED", started_at=99, finished_at=99)]
        got = node.retention_decision(trees, now=NOW, policy=policy(keep_releases=3), releases=releases)
        # C["h"] 是 pin 与最近一次，但树已不存在：不出现在保留表中，名额仍按发布次数计
        self.assertEqual(sorted(got["keep"]), [C["c"], C["d"]])
        self.assertEqual(got["delete"], [C["a"], C["b"]])

    def test_grace_boundary_and_scratch_age(self):
        trees = {C["a"]: NOW - 2 * HOUR + 1, C["b"]: NOW - 2 * HOUR}
        scratch = {"/s/new": NOW - 23 * HOUR, "/s/old": NOW - 24 * HOUR}
        got = node.retention_decision(trees, now=NOW, policy=policy(), scratch=scratch)
        self.assertEqual(list(got["keep"]), [C["a"]])
        self.assertEqual(got["delete"], [C["b"]])
        self.assertEqual(got["scratch"], ["/s/old"])

    def test_policy_requires_node_paths_and_valid_numbers(self):
        cfg = dict(runtime="/rt")
        with self.assertRaises(node.NodeError):
            node.retention_policy(cfg)
        with self.assertRaises(node.NodeError):
            node.retention_policy(dict(cfg, retention=dict(journal="/j")))
        with self.assertRaises(node.NodeError):
            node.retention_policy(dict(cfg, retention=dict(journal="/j", receipts="/r", keep_releases=0)))
        got = node.retention_policy(dict(cfg, retention=dict(journal="/j", receipts="/r", grace_seconds=60)))
        self.assertEqual((got["grace_seconds"], got["keep_releases"], got["link_roots"], got["scratch"]),
                         (60, 3, ["/rt"], []))


class RetentionReferences(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.sources = os.path.join(self.root, "sources")
        for k in "abcd":
            os.makedirs(os.path.join(self.sources, C[k], "apps", "deploy", "local"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_mounts_compose_labels_and_mounts_through_links(self):
        runtime_link = os.path.join(self.root, "openbao-config")
        os.symlink(os.path.join(self.sources, C["d"], "apps", "deploy", "local"), runtime_link)
        entries = [
            dict(Name="/platform-local-openbao-1", Config=dict(Labels={}),
                 Mounts=[dict(Type="bind", Source=os.path.join(self.sources, C["a"], "apps/deploy/local/data/x"))]),
            dict(Name="/kailo-knowledge-app-1", Mounts=[], Config=dict(Labels={
                node.COMPOSE_WORKDIR_LABEL: os.path.join(self.sources, C["b"], "apps/knowledge/fork/deploy"),
                node.COMPOSE_FILES_LABEL: "/elsewhere/compose.yaml," + os.path.join(self.sources, C["c"], "x.yaml")})),
            dict(Name="/openmeter", Config=dict(Labels={}), Mounts=[dict(Type="bind", Source=runtime_link + "/x.hcl")]),
            dict(Name="/unrelated", Config=dict(Labels={}), Mounts=[dict(Type="volume", Source="/var/lib/docker/v")]),
        ]
        refs = node.container_references(entries, self.sources)
        self.assertEqual(refs[C["a"]], ["容器 platform-local-openbao-1（挂载）"])
        self.assertEqual(refs[C["b"]], ["容器 kailo-knowledge-app-1（Compose 项目目录）"])
        self.assertEqual(refs[C["c"]], ["容器 kailo-knowledge-app-1（Compose 文件）"])
        self.assertEqual(refs[C["d"]], ["容器 openmeter（挂载经链接）"])
        self.assertEqual(len(refs), 4)

    def test_links_under_scan_roots_point_at_trees(self):
        runtime = os.path.join(self.root, "runtime")
        os.makedirs(os.path.join(runtime, "data", "deep", "er"))
        os.symlink(os.path.join(self.sources, C["a"], "apps"), os.path.join(runtime, "current"))
        os.symlink("../../sources/" + C["b"] + "/apps/x", os.path.join(runtime, "data", "relative"))
        os.symlink(os.path.join(self.sources, C["c"]), os.path.join(runtime, "data", "deep", "er", "too-deep"))
        os.symlink("/etc/hostname", os.path.join(runtime, "data", "unrelated"))
        refs, unreadable = node.link_references([runtime], self.sources, max_depth=1)
        self.assertEqual(sorted(refs), [C["a"], C["b"]])
        self.assertEqual(unreadable, [])
        refs, _ = node.link_references([runtime], self.sources, max_depth=6)
        self.assertIn(C["c"], refs)
        with self.assertRaises(node.NodeError):
            node.link_references([os.path.join(self.root, "missing")], self.sources, 6)
        locked = os.path.join(runtime, "data", "container-owned")
        os.makedirs(locked, mode=0o000)
        try:
            refs, unreadable = node.link_references([runtime], self.sources, max_depth=6)
        finally:
            os.chmod(locked, 0o755)
        self.assertEqual(unreadable if os.geteuid() else [locked], [locked])
        self.assertIn(C["a"], refs)


class RetentionRun(unittest.TestCase):
    """run_retention 端到端（本地临时目录；Docker 与 origin/main 以替身注入）。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        r = self.root = self.tmp.name
        self.sources = os.path.join(r, "sources")
        self.journal = os.path.join(r, "releases")
        self.receipts = os.path.join(r, "receipts")
        self.scratch = os.path.join(r, "scratch")
        runtime = os.path.join(r, "runtime")
        for path in (self.journal, os.path.join(r, "queue", "jobs"), runtime, self.scratch):
            os.makedirs(path)
        old = NOW - 100 * HOUR
        for k in "abcde":
            tree = os.path.join(self.sources, C[k])
            os.makedirs(os.path.join(tree, "apps", "deploy"))
            with open(os.path.join(tree, "apps", "deploy", "file"), "w") as s:
                s.write("x" * 5000)
            with open(os.path.join(tree, "ready.json"), "w") as s:
                json.dump(dict(commit=C[k]), s)
            for path in (os.path.join(tree, "ready.json"), tree):
                os.utime(path, (old, old))
        with open(os.path.join(self.sources, C["a"], "check.json"), "w") as s:
            json.dump(dict(commit=C["a"], diff=""), s)
        os.utime(os.path.join(self.sources, C["a"], "check.json"), (old, old))
        os.utime(os.path.join(self.sources, C["a"]), (old, old))
        # 当前 pin = b
        os.makedirs(os.path.join(self.journal, C["b"]))
        with open(os.path.join(self.journal, C["b"], "deploy.json"), "w") as s:
            json.dump(dict(state="SUCCEEDED", started_at=1, finished_at=2), s)
        # c 被运行目录中的链接引用；d 被容器挂载
        os.symlink(os.path.join(self.sources, C["c"], "apps", "deploy"), os.path.join(runtime, "link"))
        self.containers = [dict(Name="/openbao", Config=dict(Labels={}),
                                Mounts=[dict(Type="bind", Source=os.path.join(self.sources, C["d"], "apps"))])]
        # go module cache：只读目录树，超过 24h；另一个新的暂存
        cache = os.path.join(self.scratch, "agent-a", "pkg", "mod")
        os.makedirs(cache)
        with open(os.path.join(cache, "m.go"), "w") as s:
            s.write("package m")
        os.chmod(os.path.join(cache, "m.go"), 0o444)
        for path in (cache, os.path.dirname(cache), os.path.join(self.scratch, "agent-a")):
            os.chmod(path, 0o555)
            os.utime(path, (old, old))
        os.makedirs(os.path.join(self.scratch, "agent-b"))
        os.utime(os.path.join(self.scratch, "agent-b"), (NOW - HOUR, NOW - HOUR))
        self.cfg = dict(sources=self.sources, queue=os.path.join(r, "queue"), runtime=runtime,
                        retention=dict(journal=self.journal, receipts=self.receipts, scratch=[self.scratch]))
        self.saved = node.all_containers, node.origin_main
        node.all_containers = lambda: self.containers
        node.origin_main = lambda cfg: None

    def tearDown(self):
        node.all_containers, node.origin_main = self.saved
        for folder, dirs, files in os.walk(self.root):
            for name in dirs:
                path = os.path.join(folder, name)
                if not os.path.islink(path):
                    os.chmod(path, 0o755)
        self.tmp.cleanup()

    def trees(self):
        return sorted(os.listdir(self.sources))

    def test_dry_run_reports_and_deletes_nothing(self):
        report = node.run_retention(self.cfg, dry_run=True, now=NOW)
        self.assertEqual(sorted(t["commit"] for t in report["trees"]), [C["a"], C["e"]])
        self.assertEqual(sorted(report["kept"]), [C["b"], C["c"], C["d"]])
        self.assertTrue(report["kept"][C["c"]][0].startswith("链接 "))
        self.assertEqual([s["path"] for s in report["scratch"]], [os.path.join(self.scratch, "agent-a")])
        self.assertGreater(report["estimated_bytes"], 0)
        self.assertEqual(self.trees(), sorted(C[k] for k in "abcde"))
        self.assertTrue(os.path.isdir(os.path.join(self.scratch, "agent-a", "pkg", "mod")))
        self.assertFalse(os.path.exists(self.receipts))

    def test_apply_archives_receipts_then_deletes_and_clears_read_only_cache(self):
        report = node.run_retention(self.cfg, dry_run=False, keep=[C["e"]], now=NOW)
        self.assertEqual([t["commit"] for t in report["trees"]], [C["a"]])
        self.assertEqual(self.trees(), sorted(C[k] for k in "bcde"))
        self.assertEqual(sorted(os.listdir(os.path.join(self.receipts, C["a"]))), ["check.json", "ready.json"])
        with open(os.path.join(self.receipts, C["a"], "ready.json")) as s:
            self.assertEqual(json.load(s), dict(commit=C["a"]))
        self.assertEqual(os.listdir(self.scratch), ["agent-b"])
        # 重跑幂等：无可删
        again = node.run_retention(self.cfg, dry_run=False, keep=[C["e"]], now=NOW)
        self.assertEqual((again["trees"], again["scratch"]), ([], []))

    def test_unreadable_reference_facts_stop_without_deleting(self):
        def broken():
            raise node.NodeError("docker 不可用")
        node.all_containers = broken
        with self.assertRaises(node.NodeError):
            node.run_retention(self.cfg, dry_run=False, now=NOW)
        self.cfg["retention"]["link_roots"] = [os.path.join(self.root, "missing")]
        node.all_containers = lambda: self.containers
        with self.assertRaises(node.NodeError):
            node.run_retention(self.cfg, dry_run=False, now=NOW)
        self.assertEqual(self.trees(), sorted(C[k] for k in "abcde"))

    def test_active_jobs_and_pending_requests_keep_their_trees(self):
        job = os.path.join(self.cfg["queue"], "jobs", "1" * 32)
        os.makedirs(job)
        with open(os.path.join(job, "status.json"), "w") as s:
            json.dump(dict(state="RUNNING", commit=C["a"]), s)
        os.makedirs(os.path.join(self.cfg["queue"], "pending", "feedback"))
        with open(os.path.join(self.cfg["queue"], "pending", "feedback", "2" * 32 + ".json"), "w") as s:
            json.dump(dict(commit=C["e"]), s)
        report = node.run_retention(self.cfg, dry_run=True, now=NOW)
        self.assertEqual(report["trees"], [])
        self.assertEqual(report["kept"][C["a"]], ["CI 队列中未结束的任务"])


class FakeDocker:
    """记录 docker 子命令；image inspect 只认 present 中的引用；prune 时记下当时存在的占位容器。"""

    def __init__(self, present, stale=(), fail_prune=False):
        self.present, self.stale, self.fail_prune = present, list(stale), fail_prune
        self.calls, self.holds, self.held_during_prune = [], [], None

    def __call__(self, argv):
        self.calls.append(argv[:2])
        if argv[:2] == ["image", "inspect"]:
            if argv[-1] not in self.present:
                raise node.NodeError("No such image")
            return self.present[argv[-1]]
        if argv[0] == "ps":
            return "\n".join(self.stale)
        if argv[0] == "create":
            self.holds.append(argv[-2])
            return "hold-%d" % len(self.holds)
        if argv[0] == "rm":
            self.stale = [c for c in self.stale if c not in argv]
            self.holds = [h for i, h in enumerate(self.holds) if "hold-%d" % (i + 1) not in argv] \
                if any(a.startswith("hold-") for a in argv) else self.holds
            return ""
        if argv[:2] == ["image", "prune"]:
            self.held_during_prune = list(self.holds)
            if self.fail_prune:
                raise node.NodeError("prune 失败")
            return "Total reclaimed space: 1.5GB"
        if argv[:2] == ["builder", "prune"]:
            return "Total:\t0B"
        if argv[:2] == ["system", "df"]:
            return json.dumps(dict(Type="Images", Reclaimable="9GB"))
        raise AssertionError(argv)


class CheckImageProtection(unittest.TestCase):
    MAIN, PIN = b"FROM main", b"FROM pin"

    def show(self, commit, path):
        self.assertEqual(path, "tools/check.Dockerfile")
        return {C["a"]: self.MAIN, C["b"]: self.PIN, C["c"]: self.MAIN}.get(commit)

    def ref(self, recipe):
        return "local/kailo-check:" + node.hashlib.sha256(recipe).hexdigest()

    def test_recipes_of_main_and_pin_name_the_protected_images(self):
        got = node.protected_check_images([(C["a"], "origin/main"), (C["b"], "pin"), (C["c"], "keep"), (None, "x")],
                                          self.show)
        self.assertEqual(got, {self.ref(self.MAIN): ["origin/main", "keep"], self.ref(self.PIN): ["pin"]})
        with self.assertRaises(node.NodeError):
            node.protected_check_images([(C["d"], "pin")], self.show)

    def test_protected_images_are_held_by_created_containers_during_image_prune(self):
        protect = node.protected_check_images([(C["a"], "origin/main"), (C["b"], "pin")], self.show)
        fake = FakeDocker({self.ref(self.MAIN): "sha256:main"}, stale=["old-hold"])  # pin 的镜像本机不存在
        got = node.docker_prune(False, protect, docker=fake)
        self.assertEqual(fake.held_during_prune, ["sha256:main"])
        self.assertEqual(fake.holds, [])
        self.assertEqual(fake.stale, [])  # 上次遗留的占位容器先被清理
        self.assertLess(fake.calls.index(["create", "--pull=never"]), fake.calls.index(["image", "prune"]))
        self.assertEqual(got["reclaimed"], {"image": "1.5GB", "builder": "0B"})
        self.assertEqual(got["protected"][self.ref(self.PIN)]["image"], None)

    def test_holds_are_removed_when_prune_fails_and_dry_run_creates_nothing(self):
        protect = node.protected_check_images([(C["a"], "origin/main")], self.show)
        fake = FakeDocker({self.ref(self.MAIN): "sha256:main"}, fail_prune=True)
        with self.assertRaises(node.NodeError):
            node.docker_prune(False, protect, docker=fake)
        self.assertEqual(fake.holds, [])
        dry = FakeDocker({self.ref(self.MAIN): "sha256:main"})
        got = node.docker_prune(True, protect, docker=dry)
        self.assertNotIn(["create", "--pull=never"], dry.calls)
        self.assertNotIn(["image", "prune"], dry.calls)
        self.assertEqual(got["protected"][self.ref(self.MAIN)], dict(image="sha256:main", reasons=["origin/main"]))


class LongRunningContainers(unittest.TestCase):
    """部署附带损伤只比较有重启策略、不属于一次性演练项目的容器。"""

    def test_keeps_restartable_and_drops_ephemeral_and_disposable(self):
        found = {"a": "core-db", "b": "agent-test-pg", "c": "kailo-wren-conformance-1-ui", "d": "asr"}
        lines = "\n".join(["a\tunless-stopped\tplatform-local", "b\tno\t",
                           "c\ton-failure\tkailo-wren-conformance-1", "d\talways\tasr-service"])
        saved = node.out
        node.out = lambda argv: lines
        try:
            kept = node.long_running(found, ("*-conformance*", "*-receiver*"))
        finally:
            node.out = saved
        self.assertEqual(kept, {"a": "core-db", "d": "asr"})

    def test_nothing_running_reads_nothing(self):
        self.assertEqual(node.long_running({}, ()), {})


if __name__ == "__main__":
    unittest.main()


class PublicClientBuildConfig(unittest.TestCase):
    def test_node_returns_only_digests_of_exact_ci_environment_inputs(self):
        values = node.public_build_config_values({"environment": {
            "PLATFORM_DISPLAY_NAME": "Test", "UNRELATED": "not-selected",
        }}, ["PLATFORM_DISPLAY_NAME", "BUZZ_ANDROID_GOOGLE_SERVICES_JSON"])
        self.assertEqual(set(values), {"PLATFORM_DISPLAY_NAME", "BUZZ_ANDROID_GOOGLE_SERVICES_JSON"})
        self.assertIsNone(values["BUZZ_ANDROID_GOOGLE_SERVICES_JSON"])
        self.assertRegex(values["PLATFORM_DISPLAY_NAME"], r"^[0-9a-f]{64}$")
        self.assertNotIn("Test", json.dumps(values))
        with self.assertRaises(node.NodeError):
            node.public_build_config_values({"environment": {}}, ["bad-name"])

    def test_remote_and_original_builder_configuration_identities_agree(self):
        from unittest.mock import patch
        orch = _orchestrator()
        artifact = {"build_args": ["PLATFORM_DISPLAY_NAME"], "optional_build_args": ["BUZZ_ANDROID_GOOGLE_SERVICES_JSON"]}
        environment = {"PLATFORM_DISPLAY_NAME": "Test", "BUZZ_ANDROID_GOOGLE_SERVICES_JSON": "{}"}
        values = node.public_build_config_values({"environment": environment}, artifact["build_args"] + artifact["optional_build_args"])
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(orch.model.um.public_build_config_digest(artifact),
                             orch.model.um.public_build_config_digest(artifact, values))

    def test_record_accepts_exact_configuration_and_rejects_post_plan_change(self):
        orch = _orchestrator()
        source, artifact, config = ("sha256:" + c * 64 for c in "abc")
        unit = dict(key=source, build_config_digest=config)
        basic = f"+    source_digest: {source}\n+    artifact_digest: {artifact}\n"
        self.assertEqual(orch.upstream_build_values("mobile", basic, unit, {"build_config_digest": config})["build_config_digest"], config)
        changed = basic + f"+    build_config_digest: {config}\n"
        self.assertEqual(orch.upstream_build_values("mobile", changed, unit, {"build_config_digest": "none"})["artifact_digest"], artifact)
        with self.assertRaises(orch.ReleaseError):
            orch.upstream_build_values("mobile", basic, unit, {"build_config_digest": "none"})
        with self.assertRaises(orch.ReleaseError):
            orch.upstream_build_values("mobile", basic + f"+    build_config_digest: {source}\n", unit, {})
        with self.assertRaises(orch.ReleaseError):
            orch.upstream_build_values("mobile", changed + f"+    source_digest: {source}\n", unit, {})
