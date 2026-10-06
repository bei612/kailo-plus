# This file is only used for OSS, it will force deploy the mdl for the OSS users
# Since we allow users to customize llm and embedding models, which means qdrant collections may need to be recreated
# So, this file automates the process of force deploying the mdl

import asyncio
import os
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from src.providers.engine.native_identity import native_headers

if Path(".env.dev").exists():
    load_dotenv(".env.dev", override=True)


async def force_deploy():
    # A lost response cannot establish that this mutation was not applied.
    # Do not automatically replay it; leave the startup failure visible.
    async with aiohttp.ClientSession() as session:
        endpoint = os.environ["WREN_UI_ENDPOINT"]
        headers = await native_headers(
            session, endpoint, aiohttp.ClientTimeout(total=60)
        )
        async with session.post(
            f"{endpoint}/api/graphql",
            headers=headers,
            allow_redirects=False,
            json={
                "query": "mutation Deploy($force: Boolean) { deploy(force: $force) }",
                "variables": {"force": True},
            },
            timeout=aiohttp.ClientTimeout(total=60),  # 60 seconds
        ) as response:
            response.raise_for_status()
            res = await response.json()
            data = res.get("data") if isinstance(res, dict) else None
            deploy = data.get("deploy") if isinstance(data, dict) else None
            if (
                not isinstance(deploy, dict)
                or deploy.get("status") != "SUCCESS"
                or res.get("errors")
                or deploy.get("error")
            ):
                raise RuntimeError("Native model deployment was not confirmed")
            print("Native model deployment response confirmed")


if os.getenv("ENGINE", "wren_ui") == "wren_ui":
    asyncio.run(force_deploy())
