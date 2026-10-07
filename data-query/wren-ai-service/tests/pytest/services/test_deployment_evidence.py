"""Native deployment state control flow; external pipeline/framework boundaries only."""

import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class Model:
    execution_id = None
    error = None

    def __init__(self, **values):
        self.__dict__.update(values)


class Missing(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail


def unchanged(*args, **kwargs):
    return lambda function: function


SOURCE = Path(__file__).resolve().parents[3] / "src/web/v1"
dependencies = {
    "cachetools": types.SimpleNamespace(TTLCache=lambda **kwargs: {}),
    "fastapi": types.SimpleNamespace(HTTPException=Missing),
    "langfuse.decorators": types.SimpleNamespace(observe=unchanged),
    "pydantic": types.SimpleNamespace(BaseModel=Model, AliasChoices=lambda *args: args, Field=lambda **kwargs: None),
    "src.core.pipeline": types.SimpleNamespace(BasicPipeline=object),
    "src.utils": types.SimpleNamespace(trace_metadata=lambda function: function),
    "src.web.v1.services": types.SimpleNamespace(BaseRequest=Model),
}
with patch.dict(sys.modules, dependencies):
    spec = importlib.util.spec_from_file_location("deployment_evidence", SOURCE / "services/semantics_preparation.py")
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)


class Pipeline:
    def __init__(self, fail):
        self.fail = fail

    async def run(self, **kwargs):
        if self.fail:
            raise RuntimeError("native indexing failed")


class DeploymentEvidence(unittest.IsolatedAsyncioTestCase):
    async def test_actual_terminal_records_retain_native_attempt(self):
        for failure, status in [(False, "finished"), (True, "failed")]:
            service = native.SemanticsPreparationService({
                name: Pipeline(failure) for name in [
                    "db_schema", "historical_question", "table_description", "sql_pairs", "project_meta"
                ]
            })
            await service.prepare_semantics(native.SemanticsPreparationRequest(
                mdl="{}", mdl_hash="manifest", execution_id="deploy-log", request_from="ui", project_id="project"
            ))
            result = service.get_prepare_semantics_status(native.SemanticsPreparationStatusRequest(mdl_hash="manifest"))
            self.assertEqual((result.status, result.execution_id), (status, "deploy-log"))
            service._prepare_semantics_statuses.clear()
            with self.assertRaises(Missing) as caught:
                service.get_prepare_semantics_status(native.SemanticsPreparationStatusRequest(mdl_hash="manifest"))
            self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
