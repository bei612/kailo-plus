"""Pure parts of the CI node release stages (ADR-20): python3 -I -m unittest discover -s tools/release"""
import importlib.util
import os
import sys
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


if __name__ == "__main__":
    unittest.main()
