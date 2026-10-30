"""依赖下载缓存的构建参数推导（07 §2.1）：python3 -I -B -m unittest discover -s tools/ci/dep-cache"""
import http.server
import os
import socket
import subprocess
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ORIGIN = "https://proxy.golang.org,direct"


class Healthy(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - http.server API
        ok = self.path in ("/-/ping", "/healthz")
        self.send_response(200 if ok else 404)
        self.end_headers()

    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class BuildArgs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Healthy)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.up = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.down = f"http://127.0.0.1:{free_port()}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def derive(self, dockerfile_text, npm, go):
        with tempfile.TemporaryDirectory() as tmp:
            dockerfile = os.path.join(tmp, "Dockerfile")
            with open(dockerfile, "w") as stream:
                stream.write(dockerfile_text)
            script = ('. "$1"; dependency_cache_args "$2" >"$3"; '
                      'for a in "${DEPENDENCY_CACHE_ARGS[@]}"; do printf "%s\\n" "$a"; done')
            env = dict(os.environ, KAILO_NPM_CACHE_URL=npm, KAILO_GO_CACHE_URL=go)
            log = os.path.join(tmp, "log")
            r = subprocess.run(["bash", "-euo", "pipefail", "-c", script, "-", os.path.join(HERE, "build-args.sh"),
                                dockerfile, log], capture_output=True, text=True, env=env, check=True)
            with open(log) as stream:
                return r.stdout.split("\n")[:-1], stream.read()

    BOTH = "FROM node AS ui\nARG NPM_REGISTRY=\nRUN x\nFROM golang AS go\nARG GOPROXY=https://proxy.golang.org,direct\n"

    def test_healthy_caches_are_used_with_go_fallback_to_the_origin(self):
        args, log = self.derive(self.BOTH, self.up, self.up)
        self.assertEqual(args, ["--build-arg", f"NPM_REGISTRY={self.up}/", "--build-arg", f"GOPROXY={self.up}|{ORIGIN}"])
        self.assertIn("未命中由缓存回源", log)

    def test_unhealthy_caches_fall_back_to_the_origin_and_say_so(self):
        args, log = self.derive(self.BOTH, self.down, self.down)
        self.assertEqual(args, ["--build-arg", f"GOPROXY={ORIGIN}"])
        self.assertIn("直连 registry.npmjs.org（回源）", log)
        self.assertIn("直连 proxy.golang.org（回源）", log)

    def test_only_declared_args_are_passed(self):
        self.assertEqual(self.derive("FROM scratch\nARG GOPROXY_ARG\nARG NPM_REGISTRY_URL=x\n", self.up, self.up), ([], ""))
        args, _ = self.derive("FROM golang\n  ARG GOPROXY\n", self.up, self.up)
        self.assertEqual(args, ["--build-arg", f"GOPROXY={self.up}|{ORIGIN}"])

    def test_empty_url_disables_a_cache(self):
        args, log = self.derive(self.BOTH, "", "")
        self.assertEqual(args, ["--build-arg", f"GOPROXY={ORIGIN}"])
        self.assertIn("npm 缓存不可用", log)

    def test_repository_dockerfiles_declare_the_cached_downloads(self):
        root = os.path.realpath(os.path.join(HERE, "..", "..", ".."))
        for rel, arg in (("worker/Dockerfile", "GOPROXY"),
                         ("file-storage/tools/docker/images/cells/buildx-dockerfile", "NPM_REGISTRY"),
                         ("file-storage/tools/docker/images/cells/buildx-dockerfile", "GOPROXY")):
            path = os.path.join(root, rel)
            if not os.path.isfile(path):
                self.skipTest(f"{rel} 不在本检出中")
            args, _ = self.derive(open(path, encoding="utf-8").read(), self.up, self.up)
            self.assertTrue(any(a.startswith(arg + "=") for a in args), rel)


if __name__ == "__main__":
    unittest.main()
