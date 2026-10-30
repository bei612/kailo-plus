#!/usr/bin/env python3
"""入口拓扑叠加（.design 02 DD-164(10)、07 §4.6「入口拓扑」）。

组件 origin 由 Kailo 网关的组件 listener 对外提供（model-gateway-config.yaml 的 component-edge-*，
容器端口固定）。哪些组件已经迁移到网关、它们的公开端口是多少，只有一个声明：运行目录 .env 的
KAILO_EDGE_COMPONENTS（逗号分隔的 <组件>=<公开端口>，组件为 file-storage、knowledge、data-query、
document-editor；空值即全部未迁移）。本脚本把它渲染成运行目录叠加 data/edge/agentgateway.compose.json，
发布入口（tools/release/release.yaml overlays）在每次 Compose 调用中带上它，漂移收敛据此重建网关。

  edge-overlay.py render   渲染并原子替换（0644）；声明为空时删除叠加。启用一个组件前核对宿主上没有
                           网关以外的容器仍发布该端口——组件尚未改为不公开端口时拒绝，避免网关起不来。
  edge-overlay.py check    只读：运行目录叠加必须等于当前声明的渲染结果（不等即退出 1）。

由已 cd 到 deploy/local 的调用方以 KAILO_RUNTIME_DIR=<运行目录> 执行；不读写 secret。
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

LISTENERS = {  # 组件 → 网关容器端口（model-gateway-config.yaml 的 component-edge-<组件> bind）
    "file-storage": 18092,
    "knowledge": 18094,
    "data-query": 18095,
    "document-editor": 18096,
}
RELATIVE = pathlib.Path("data/edge/agentgateway.compose.json")


def refuse(message):
    print("入口拓扑叠加未渲染：" + message, file=sys.stderr)
    sys.exit(2)


def env_values(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
        if match:
            value = match.group(2)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            values[match.group(1)] = value
    return values


def declared(value):
    """KAILO_EDGE_COMPONENTS → {组件: 公开端口}；格式不符即拒绝，不做部分渲染。"""
    result = {}
    if not value.strip():
        return result
    ports = set()
    for item in value.split(","):
        match = re.fullmatch(r"([a-z-]+)=([1-9][0-9]{0,4})", item)
        if not match or match.group(1) not in LISTENERS or match.group(1) in result:
            refuse("KAILO_EDGE_COMPONENTS 每项必须是唯一的 <组件>=<端口>，组件取 " + "、".join(LISTENERS))
        port = int(match.group(2))
        if not 0 < port <= 65535 or port in ports:
            refuse("KAILO_EDGE_COMPONENTS 的公开端口必须有效且互不相同")
        ports.add(port)
        result[match.group(1)] = port
    return result


def render(env):
    components = declared(env.get("KAILO_EDGE_COMPONENTS", ""))
    if not components:
        return components, None
    if not env.get("PUBLIC_BIND_ADDR"):
        refuse("缺少 PUBLIC_BIND_ADDR")
    ports = ["${PUBLIC_BIND_ADDR:?必须显式提供公开入口发布地址}:%d:%d" % (port, LISTENERS[name])
             for name, port in sorted(components.items())]
    overlay = {"services": {"agentgateway": {"ports": ports}}}
    return components, json.dumps(overlay, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def held_by_others(port):
    """宿主上发布该端口的、非本项目 agentgateway 的容器名。"""
    out = subprocess.run(["sudo", "-n", "docker", "ps", "--format", "{{.Names}}\t{{.Ports}}"],
                         capture_output=True, text=True, check=True).stdout
    holders = []
    for line in out.splitlines():
        name, _, published = line.partition("\t")
        if re.search(r"(?:^|[ ,])[^ ,]*:%d->" % port, published) and not name.endswith("-agentgateway-1"):
            holders.append(name)
    return holders


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("render", "check"):
        refuse("用法：edge-overlay.py render|check")
    runtime = pathlib.Path(os.environ.get("KAILO_RUNTIME_DIR", "")).resolve()
    if not os.environ.get("KAILO_RUNTIME_DIR") or not (runtime / ".env").is_file():
        refuse("需要 KAILO_RUNTIME_DIR=<运行目录>（含 .env）")
    components, text = render(env_values(runtime / ".env"))
    target = runtime / RELATIVE
    current = target.read_text(encoding="utf-8") if target.is_file() else None
    if sys.argv[1] == "check":
        if current != text:
            print("入口拓扑叠加与 KAILO_EDGE_COMPONENTS 不一致，先运行 edge-overlay.py render", file=sys.stderr)
            sys.exit(1)
        print("入口拓扑叠加与声明一致：" + (", ".join(sorted(components)) or "无组件经网关"))
        return
    for name, port in sorted(components.items()):
        holders = held_by_others(port)
        if holders:
            refuse(f"{name} 的端口 {port} 仍由 {', '.join(holders)} 发布；先以不公开端口的声明重建该组件")
    if text is None:
        if current is not None:
            target.unlink()
        print("入口拓扑叠加：无组件经网关（叠加已删除）" if current is not None else "入口拓扑叠加：无组件经网关")
        return
    if current == text:
        print("入口拓扑叠加未变：" + ", ".join(sorted(components)))
        return
    target.parent.mkdir(mode=0o755, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".edge-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o644)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("入口拓扑叠加已渲染：" + ", ".join(sorted(components)) + "（网关在下一次发布漂移收敛时重建）")


if __name__ == "__main__":
    main()
