"""Development-box side of the release entry (ADR-20 §12 component instances):
python3 -I -B -m unittest discover -s tools/release"""
import contextlib
import importlib.util
import io
import os
import sys
import unittest

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("release_orchestrator_components",
                                               os.path.join(os.path.dirname(__file__), "orchestrator.py"))
orch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(orch)

OLD, NEW = "sha256:" + "3" * 64, "sha256:" + "6" * 64
INSTANCES = [
    dict(name="file-storage", env="/c/cells/deploy.env", project="${CELLS_COMPOSE_PROJECT}",
         pins=[dict(key="CELLS_IMAGE", artifact="file-storage-service", form="reference", repository=None, digest=NEW)]),
    dict(name="knowledge", env="/c/knowledge/native.env", project="kailo-knowledge",
         pins=[dict(key="KNOWLEDGE_APP_DIGEST", artifact="knowledge-service", form="digest",
                    repository="KNOWLEDGE_APP_REPOSITORY", digest=NEW)]),
    dict(name="document-editor", env="/c/de/native.env", project="${DOCUMENT_EDITOR_COMPOSE_PROJECT}",
         pins=[dict(key="DOCUMENT_EDITOR_IMAGE", artifact="document-editor", form="reference", repository=None,
                    digest=NEW)]),
    dict(name="data-query", env="/c/dq/native.env", project="${WREN_COMPOSE_PROJECT_NAME}",
         pins=[dict(key="WREN_UI_IMAGE", artifact="data-query-ui", form="reference", repository=None, digest=NEW)]),
]
FACTS = {
    "file-storage": dict(installed=True, project="kailo-cells-native", env={"CELLS_IMAGE": "differs"},
                         running={"file-storage-service": [OLD]}, problems=[], action="deploy"),
    "knowledge": dict(installed=True, project="kailo-knowledge", env={"KNOWLEDGE_APP_DIGEST": "equal"},
                      running={"knowledge-service": [NEW]}, problems=[], action="current"),
    "document-editor": dict(installed=False, action="not_installed"),
    "data-query": dict(installed=True, project="platform-local-wren-native", env={"WREN_UI_IMAGE": "repository"},
                       running={"data-query-ui": [NEW]}, problems=[], action="refuse"),
}


class ComponentPlan(unittest.TestCase):
    def test_entries_follow_declaration_order_and_node_facts(self):
        entries = orch.component_entries(INSTANCES, FACTS, rebuilt={})
        self.assertEqual([(e["name"], e["project"], e["action"]) for e in entries],
                         [("file-storage", "kailo-cells-native", "deploy"), ("knowledge", "kailo-knowledge", "current"),
                          ("document-editor", "${DOCUMENT_EDITOR_COMPOSE_PROJECT}", "not_installed"),
                          ("data-query", "platform-local-wren-native", "refuse")])
        self.assertEqual(entries[0]["pins"][0]["running"], [OLD])
        self.assertEqual(entries[0]["pins"][0]["env"], "differs")

    def test_a_rebuilt_artifact_forces_its_instance_to_deploy(self):
        entries = orch.component_entries(INSTANCES, FACTS, rebuilt={"knowledge-service": "knowledge-service"})
        self.assertEqual(entries[1]["action"], "deploy")
        self.assertTrue(entries[1]["pins"][0]["rebuilt"])
        self.assertIn("本次重建的新 digest", "\n".join(orch.component_lines(entries)))

    def test_old_node_code_reports_unknown(self):
        entries = orch.component_entries(INSTANCES[:1], {}, rebuilt={})
        self.assertEqual(entries[0]["action"], "unknown")
        self.assertIn("节点未回报", "\n".join(orch.component_lines(entries)))

    def test_lines_list_keys_states_and_digests_only(self):
        text = "\n".join(orch.component_lines(orch.component_entries(INSTANCES, FACTS, rebuilt={})))
        self.assertIn("file-storage（项目 kailo-cells-native）：将部署", text)
        self.assertIn(f"CELLS_IMAGE → file-storage-service {NEW[:19]}；实例 env differs；运行 {OLD[:19]}", text)
        self.assertIn("document-editor（项目 ${DOCUMENT_EDITOR_COMPOSE_PROJECT}）：实例 env 不存在", text)
        self.assertIn("deploy 将拒绝该实例（不影响平台服务）", text)
        self.assertEqual(orch.component_lines([]), [])

    def test_dry_run_lists_component_steps_after_the_platform(self):
        plan = dict(source="a" * 40, rebuild=[], units={}, pins={}, head="a" * 40, sources="/s", idp={"state": "unchanged"},
                    operated={}, deploy=dict(order=["core-bff"], config=dict(before=[], after=[])),
                    components=orch.component_entries(INSTANCES, FACTS, rebuilt={}))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            orch.rehearse(plan)
        line = next(l for l in out.getvalue().splitlines() if l.strip().startswith("deploy:"))
        self.assertLess(line.index("core-bff"), line.index("组件实例 file-storage"))
        self.assertIn("组件实例 data-query", line)  # refuse 也列出：deploy 会报告拒绝
        self.assertNotIn("组件实例 knowledge", line)
        self.assertNotIn("组件实例 document-editor", line)

    def test_deploy_and_verify_reports(self):
        release = orch.Release.__new__(orch.Release)
        release.node_stage = lambda stage: dict(
            services=[], components=[dict(component="file-storage", state="SUCCEEDED", images={"file-storage-service": NEW}),
                                     dict(component="knowledge", action="current")])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            release.deploy({})
        self.assertIn(f"组件实例 file-storage: SUCCEEDED file-storage-service {NEW[:19]}", out.getvalue())
        self.assertNotIn("knowledge", out.getvalue())
        release.node_stage = lambda stage: dict(services=[{}], idp={}, business_acceptance="NOT_RUN",
                                                components=[dict(component="file-storage"),
                                                            dict(component="document-editor", installed=False)])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            release.verify({})
        self.assertIn("1 个组件实例与 pin 一致", out.getvalue())


if __name__ == "__main__":
    unittest.main()
