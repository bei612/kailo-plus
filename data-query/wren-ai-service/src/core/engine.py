import logging
import re
from abc import ABCMeta, abstractmethod
from typing import Any, Dict, Optional, Tuple

import aiohttp
from pydantic import BaseModel

logger = logging.getLogger("wren-ai-service")


class EngineConfig(BaseModel):
    provider: str = "wren_ui"
    config: dict = {}


class Engine(metaclass=ABCMeta):
    @abstractmethod
    async def execute_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        dry_run: bool = True,
        **kwargs,
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        ...


class SQLGenerationEmpty(RuntimeError):
    """The model answered without any SQL text.

    There is nothing to dry-run, execute or correct, so the generation fails at
    once with this reason instead of sending an empty statement to the engine.
    """

    def __init__(self, finish_reason: Optional[str] = None, reasoning_only: bool = False):
        self.finish_reason = finish_reason
        self.reasoning_only = reasoning_only
        if finish_reason == "length" and reasoning_only:
            detail = "the model spent its whole output limit on hidden reasoning"
        elif finish_reason == "length":
            detail = "the model output was cut off at its output limit"
        else:
            detail = "the model returned an empty answer"
        super().__init__(f"No SQL was generated: {detail}")


def clean_generation_result(result: str) -> str:
    def _normalize_whitespace(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    return (
        _normalize_whitespace(result)
        .replace("```sql", "")
        .replace("```json", "")
        .replace('"""', "")
        .replace("'''", "")
        .replace("```", "")
        .replace(";", "")
    )


def remove_limit_statement(sql: str) -> str:
    pattern = r"\s*LIMIT\s+\d+(\s*;?\s*--.*|\s*;?\s*)$"
    modified_sql = re.sub(pattern, "", sql, flags=re.IGNORECASE)

    return modified_sql
