"""Verify the full local snapshot with the JDBC-free test classpath."""
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener
import os
import secrets
import argparse
import re
import subprocess
import sys
import tempfile
import time

TOOLS = Path(__file__).absolute().parent
WEB = TOOLS.parents[1] / "src/web"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--classpath", required=True, help="Compiled demo classes, resources and JDBC-free test libraries")
parser.add_argument("--artifacts", type=Path, required=True)
parser.add_argument("--java", default="java")
parser.add_argument("--chrome", required=True)
parser.add_argument("--suite", choices=["equipment", "site", "warehouse", "missing", "official"], default="equipment")
args = parser.parse_args()
ARTIFACTS = args.artifacts.absolute()
if args.suite in ("warehouse", "missing", "official"):
    os.environ.pop("POP_WAREHOUSE_TEST_PASSWORD", None)
    if args.suite == "warehouse":
        os.environ["POP_WAREHOUSE_TEST_PASSWORD"] = secrets.token_urlsafe(24)
    if args.suite != "official":
        os.environ["POP_WAREHOUSE_TEST_CATALOG"] = str(TOOLS / "warehouse-catalog.tsv")
    else:
        os.environ.pop("POP_WAREHOUSE_TEST_CATALOG", None)
OPENER = build_opener(ProxyHandler({}))


@contextmanager
def spring(classpath, name):
    log = ARTIFACTS / f"spring-{name}.log"
    launch = [args.java, "-Djava.awt.headless=true", "-cp", classpath, "com.shinjin.pop.PopApplication",
            "--spring.config.location=optional:classpath:/equipment-test.properties",
            "--server.address=127.0.0.1", "--server.port=0"]
    profile = "demo,warehouse-test" if args.suite in ("warehouse", "missing") else "demo"
    launch.append("--spring.profiles.active=" + profile)
    if args.suite != "official":
        dataset = "demo-centers.json" if args.suite == "equipment" else "site-centers.json"
        launch.append("--shinjin.demo.dataset=" + str(TOOLS / dataset))
    with log.open("w", encoding="utf-8") as out:
        app = subprocess.Popen(launch, stdout=out, stderr=subprocess.STDOUT, cwd=ARTIFACTS)
    try:
        for _ in range(240):
            output = log.read_text(encoding="utf-8", errors="replace")
            match = re.search(r"Tomcat started on port (\d+)", output)
            if match:
                break
            if app.poll() is not None:
                raise RuntimeError(output)
            time.sleep(.15)
        else:
            raise RuntimeError(output)
        yield "http://127.0.0.1:" + match.group(1)
    finally:
        if app.poll() is None:
            app.terminate()
            app.wait(timeout=10)


def browser(origin):
    class Proxy(SimpleHTTPRequestHandler):
        def proxy(self):
            size = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(size) if size else None
            request = Request(origin + self.path, data=body, method=self.command, headers={
                key: self.headers[key] for key in ("Content-Type", "Cookie", "Accept") if key in self.headers
            })
            try:
                response = OPENER.open(request, timeout=20)
            except HTTPError as error:
                response = error
            with response:
                data = response.read()
                self.send_response(response.code)
                self.send_header("Content-Length", str(len(data)))
                for key in ("Content-Type", "Set-Cookie", "Cache-Control"):
                    if key in response.headers:
                        self.send_header(key, response.headers[key])
                self.end_headers()
                try:
                    self.wfile.write(data)
                except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                    pass

        def do_GET(self):
            if self.path.startswith(("/api/",)):
                self.proxy()
            else:
                super().do_GET()
        do_POST = proxy
        do_PUT = proxy
        def log_message(self, *_):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Proxy, directory=str(WEB / "dist"))) as web:
        Thread(target=web.serve_forever, daemon=True).start()
        profile = Path(tempfile.mkdtemp(prefix="chrome-equipment-", dir=ARTIFACTS))
        with (ARTIFACTS / "chrome.log").open("w", encoding="utf-8") as out:
            chrome = subprocess.Popen([args.chrome, "--headless=new", "--no-sandbox",
                "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--no-first-run",
                "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1", "--no-proxy-server",
                "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", f"--user-data-dir={profile}",
                "about:blank"], stdout=out, stderr=subprocess.STDOUT,
                env={k:v for k,v in os.environ.items() if not k.startswith("POP_WAREHOUSE_TEST_")})
            try:
                for _ in range(100):
                    port = profile / "DevToolsActivePort"
                    try:
                        value = port.read_text(encoding="ascii").splitlines()[0]
                        if value.isdigit():
                            break
                    except (OSError, IndexError):
                        pass
                    assert chrome.poll() is None
                    time.sleep(.2)
                else:
                    raise RuntimeError("Chrome debugging endpoint not available")
                endpoint = "http://127.0.0.1:" + value
                subprocess.run(["node", "--preserve-symlinks-main", str(TOOLS / "verify-touch.mjs"),
                                endpoint, f"http://127.0.0.1:{web.server_port}/", str(ARTIFACTS), args.suite], check=True, timeout=120)
            finally:
                if chrome.poll() is None:
                    chrome.terminate()
                    chrome.wait(timeout=10)
                web.shutdown()


ARTIFACTS.mkdir(parents=True, exist_ok=True)
with spring(args.classpath, "shell") as origin:
    if args.suite in ("warehouse", "missing", "official"):
        subprocess.run([sys.executable, str(TOOLS / "verify-warehouse-http.py"), origin, args.suite], check=True)
    else:
        subprocess.run([sys.executable, str(TOOLS / ("verify-site-http.py" if args.suite == "site" else "verify-http.py")), origin], check=True)
with spring(args.classpath, "browser") as origin:
    browser(origin)

if args.suite == "warehouse":
    value = os.environ["POP_WAREHOUSE_TEST_PASSWORD"].encode()
    for log in ARTIFACTS.glob("*.log"):
        if value in log.read_bytes():
            raise RuntimeError("Credential appeared in a test log")
    print("PASS settings credential absent from server and Chrome logs")
