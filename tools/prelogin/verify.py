"""Run isolated demo HTTP / Chrome checks against built sources, with JDBC-free test libraries."""
import argparse
import json
import re
import subprocess
import time
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler, Request

parser = argparse.ArgumentParser()
parser.add_argument("--java", default="java")
parser.add_argument("--classpath", required=True)
parser.add_argument("--artifacts", type=Path, required=True)
parser.add_argument("--suite", choices=["default","missing","group005","group105","ordinary","single","omission","empty-ftp","empty-db"], required=True)
parser.add_argument("--omit", choices=["ftp","db","printer","plant","process","machine","warehouse","popId","group","material"])
args = parser.parse_args()
if (args.suite == "omission") != bool(args.omit): parser.error("--omit is required only for the omission suite")
out = args.artifacts.absolute()
out.mkdir(exist_ok=True, parents=True)
tools = Path(__file__).absolute().parent
root = tools.parents[1]
web = build_opener(ProxyHandler({}))
test = args.suite != "default"
suite = args.suite

@contextmanager
def spring():
    flags = ["--spring.profiles.active=" + ("demo,prelogin-test" if test else "demo"),
             "--server.address=127.0.0.1","--server.port=0","--spring.config.location=optional:classpath:/prelogin-test.properties"]
    if suite in ("empty-ftp","empty-db"):
        flags += ["--shinjin.prelogin.empty-address="+suite.removeprefix("empty-")]
    if suite == "omission":
        flags += ["--shinjin.prelogin.missing="+args.omit]
    if suite == "missing":
        flags += ["--shinjin.prelogin.missing=plant,ftp,db"]
    if suite in ("group005","group105","ordinary"):
        dataset = json.loads((root/"src/api/src/main/resources/work-history-default.json").read_text(encoding="utf-8-sig"))
        dataset["stations"]["DEMO-A"]["center"] = {"group005":"005","group105":"105","ordinary":"001"}[suite]
        path=out/"synthetic-stations.json"
        path.write_text(json.dumps(dataset,ensure_ascii=False),encoding="utf-8")
        flags += ["--shinjin.demo.dataset="+str(path),"--shinjin.prelogin.missing=group,material"]
    if suite == "single":
        flags += ["--shinjin.prelogin.terminal=DEMO-B","--shinjin.prelogin.version=1.2.3"]
    log = out/"spring.log"
    with log.open("w",encoding="utf8") as stream:
        process = subprocess.Popen([args.java,"-Djava.awt.headless=true","-cp",args.classpath,"com.shinjin.pop.PopApplication",*flags],
                                   cwd=out,stdout=stream,stderr=subprocess.STDOUT)
    try:
        for _ in range(320):
            match=re.search(r"Tomcat started on port (\d+)",log.read_text(encoding="utf8",errors="replace"))
            if match: break
            if process.poll() is not None: raise RuntimeError("demo startup failed, see spring.log")
            time.sleep(.15)
        else: raise RuntimeError("Spring timeout")
        yield "http://127.0.0.1:"+match[1]
    finally:
        process.terminate()
        process.wait(timeout=15)

def request(origin,path,data=None,method=None):
    req=Request(origin+path,None if data is None else json.dumps(data).encode(),headers={"Content-Type":"application/json"},method=method)
    try: res=web.open(req,timeout=10)
    except HTTPError as exc: res=exc
    with res: return res.status,res.read()

with spring() as api:
    code,raw=request(api,"/api/pop/prelogin-settings")
    status=json.loads(raw)
    assert code==200 and set(status)=={"terminalId","groupCenter","ready","missing","version","ftpAddressPresent","dbAddressPresent"}
    assert status["groupCenter"] == (suite in ("group005","group105"))
    allowed = suite in ("default","single","ordinary","empty-ftp","empty-db") or (suite=="omission" and args.omit in ("group","material"))
    assert status["ready"] == allowed
    for service in ("ftp","db"):
        assert status[service+"AddressPresent"] == (service not in status["missing"] and suite!="empty-"+service)
    terminal=status["terminalId"]
    for route,method,data in [("", "GET",None),("/printers","PUT",{"expectedVersion":0,"outputs":{}}),
                              ("/warehouse/entry","POST",{"password":""})]:
        assert request(api,"/api/pop/admin/terminal-settings/"+terminal+route,data,method)[0]==401
    assert request(api,"/api/pop/session")[0]==401
    for mode in ("manual","scan"):
        data={"terminalId":terminal,"method":mode,"identifier":("DEMO-W03" if terminal=="DEMO-B" else "DEMO-W01") if mode=="manual" else "0000",
              "passcode":"demo-only" if mode=="manual" else ""}
        code,raw=request(api,"/api/pop/session",data)
        assert code==(200 if allowed else 409),(mode,code)
        if allowed:
            identity=json.loads(raw)
            assert identity["terminal"]["id"]==terminal
            if suite=="single": assert identity["initialView"]=="packing" and status["version"]=="1.2.3"
        if test:
            data["terminalId"]="DEMO-A2"
            assert request(api,"/api/pop/session",data)[0]==409
    print("PASS",suite,"terminal binding, readiness, both login methods and unauthenticated settings scope",flush=True)
    if suite in ("missing","default","single","group005","group105"):
        class Proxy(SimpleHTTPRequestHandler):
            def proxy(self):
                n=int(self.headers.get("Content-Length",0))
                body=self.rfile.read(n) if n else None
                req=Request(api+self.path,body,{k:self.headers[k] for k in ("Content-Type","Cookie","Accept") if k in self.headers},method=self.command)
                try: resp=web.open(req,timeout=15)
                except HTTPError as exc: resp=exc
                with resp:
                    data=resp.read()
                    self.send_response(resp.status)
                    self.send_header("Content-Length",str(len(data)))
                    for k in ["Content-Type","Set-Cookie","Cache-Control"]:
                        if k in resp.headers:self.send_header(k,resp.headers[k])
                    self.end_headers()
                    try: self.wfile.write(data)
                    except (ConnectionResetError,ConnectionAbortedError,BrokenPipeError): pass
            def do_GET(self):
                if self.path.startswith("/api/"): self.proxy()
                else: super().do_GET()
            do_POST=do_PUT=proxy
            def log_message(self,*_): pass
        with ThreadingHTTPServer(("127.0.0.1",0),partial(Proxy,directory=str(root/"src/web/dist"))) as server:
            Thread(target=server.serve_forever,daemon=True).start()
            try:
                subprocess.run(["node","--preserve-symlinks-main",str(tools/"verify-browser.mjs"),
                    "http://127.0.0.1:"+str(server.server_port),suite,str(out)],check=True,timeout=120)
            finally: server.shutdown()
