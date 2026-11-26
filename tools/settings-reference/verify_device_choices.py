"""Compare only in-process data with a private loopback demo. Prints counts, never master values."""
import argparse
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.request import build_opener, HTTPCookieProcessor

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("jar",type=Path)
    parser.add_argument("reference",type=Path)
    args=parser.parse_args()
    data=json.loads(args.reference.read_text("utf-8-sig"));expected=data["devices"]
    java=Path(os.environ["JAVA_HOME"])/"bin"/("java.exe" if os.name=="nt" else "java")
    with tempfile.TemporaryDirectory(prefix="pop-readonly-device-") as tmp:
        with socket.socket() as s:s.bind(("127.0.0.1",0));port=s.getsockname()[1]
        base=f"http://127.0.0.1:{port}"
        scope="/".join(data[k] for k in ("factory","plant","center"))
        command=[str(java),"-jar",str(args.jar.resolve()),"--spring.profiles.active=demo","--server.address=127.0.0.1",
                 f"--server.port={port}","--shinjin.settings-reference.file="+str(args.reference.resolve()),
                 "--shinjin.settings-reference.terminal=DEMO-A","--shinjin.settings-reference.scope="+scope,
                 "--shinjin.prelogin.local-store="+str(Path(tmp)/"settings.json")]
        with (Path(tmp)/"server.log").open("wb") as log:
            proc=subprocess.Popen(command,stdout=log,stderr=log)
            try:
                op=build_opener(HTTPCookieProcessor(CookieJar()))
                for _ in range(180):
                    if proc.poll() is not None:raise RuntimeError("private reference server stopped")
                    try:
                        with op.open(base+"/api/pop/context"):break
                    except OSError:time.sleep(.1)
                else:raise TimeoutError("server")
                def load(kind):
                    with op.open(base+"/api/pop/prelogin-site-equipment/DEMO-A/"+kind+"/equipment") as r:return json.load(r)
                def owners(src):
                    return {"self":"DEMO-A","other":"다른 단말","free":""}[src["ownership"]]
                machine=load("machine");pop=load("popId")
                assert [(r["code"],r["name"],r["description"],r["owner"]) for r in machine["machines"][1:]]==[(r["code"],r["name"],r["description"],owners(r)) for r in expected["machines"]]
                assert machine["machines"][0]["code"]=="000000"
                assert machine["saved"]["machines"]==expected["selectedMachineCodes"]
                assert [(r["code"],r["name"],r["owner"]) for r in pop["popRows"]]==[(r["code"],r["name"],owners(r)) for r in expected["popRows"]]
                assert machine["site"]["plant"]==data["plant"] and machine["site"]["center"]==data["center"]
                print("PASS private reference counts: machines=%d, POP choices=%d, local machine slots=%d; ordered code/name/ownership and selected site matched."%(len(expected["machines"]),len(expected["popRows"]),len(expected["selectedMachineCodes"])))
            finally:proc.terminate();proc.wait(15)
if __name__=="__main__":main()
