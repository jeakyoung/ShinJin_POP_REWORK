"""Run the unauthenticated site, POP ID and machine screens against an isolated Spring demo server."""
import argparse
import json
import os
from pathlib import Path
from contextlib import contextmanager
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[2]

@contextmanager
def server(jar,folder,port,password):
    base=f"http://127.0.0.1:{port}"
    java=Path(os.environ["JAVA_HOME"])/"bin"/("java.exe" if os.name=="nt" else "java")
    args=[str(java),"-jar",str(jar),"--server.address=127.0.0.1",f"--server.port={port}",
          "--spring.profiles.active=demo,prelogin-test,warehouse-test","--shinjin.prelogin.terminal=DEMO-A",
          "--shinjin.prelogin.missing=plant,process,machine,popId,warehouse,material",
          "--shinjin.prelogin.local-store="+str(folder/"settings.json"),
          "--spring.web.resources.static-locations="+(ROOT/"src/web/dist").as_uri()+"/"]
    catalog=folder/"warehouse.tsv"
    reference=json.loads((ROOT/"src/api/src/main/resources/work-history-default.json").read_text("utf-8"))
    factory=next(t["factory"] for t in reference["terminals"] if t["id"]=="DEMO-A")
    catalog.write_text("\t".join([factory,"P1B","003","W01","합성 창고"]),"utf-8")
    with (folder/"server.log").open("wb") as log:
        proc=subprocess.Popen(args,cwd=folder,stdout=log,stderr=log,env={**os.environ,"POP_WAREHOUSE_TEST_PASSWORD":password,"POP_WAREHOUSE_TEST_CATALOG":str(catalog)})
        try:
            for _ in range(180):
                if proc.poll() is not None:raise RuntimeError("Demo Spring process exited")
                try:
                    with urllib.request.urlopen(base+"/api/pop/context"):break
                except OSError:time.sleep(.1)
            else:raise TimeoutError("Spring startup")
            yield base
        finally:
            proc.terminate()
            proc.wait(15)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("jar",type=Path)
    parser.add_argument("evidence",type=Path)
    parser.add_argument("--api-only",action="store_true")
    parser.add_argument("--width",type=int,default=1280)
    parser.add_argument("--height",type=int,default=800)
    a=parser.parse_args();a.evidence.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pop-prelogin-devices-") as tmp, sync_playwright() as pw:
        with socket.socket() as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
        password=secrets.token_urlsafe(25);folder=Path(tmp)
        browser=pw.chromium.launch(channel="chrome");ctx=browser.new_context(has_touch=True,viewport={"width":a.width,"height":a.height})
        with server(a.jar.resolve(),folder,port,password) as base:
            req=ctx.request
            status_url=base+"/api/pop/prelogin-settings?terminalId=DEMO-A"
            def status():return req.get(status_url).json()
            end=base+"/api/pop/prelogin-site-equipment/DEMO-A/"
            process=base+"/api/pop/prelogin-details/DEMO-A/process"
            warehouse=base+"/api/pop/prelogin-details/DEMO-A/warehouse"
            def view(kind):return req.get(end+kind+"/equipment").json()
            def site_body(v):return {"expectedVersion":v["version"],"equipmentVersion":v["version"],"plant":"P1B","center":"003"}
            def scope_body(v):return {"expectedVersion":v["version"],"scopePlant":v["site"]["plant"],"scopeCenter":v["site"]["center"],"siteRevision":v["siteRevision"]}
            def put(u,body):
                r=req.put(u,data=body);assert r.ok,(r.status,r.text());return r
            other=browser.new_context()
            assert "plant" in status()["missing"] and req.get(end+"machine/equipment").status==409
            first=view("plant");assert first["site"]["plant"]==""
            site=next(s for s in first["sites"] if s["plant"]=="P1B" and s["center"]=="003")
            page=ctx.new_page()
            def button(name,scope=None):return (scope or page).get_by_role("button",name=name,exact=True)
            def tile(key):return page.locator(".prelogin-settings [data-setting="+key+"]")
            def prompt(answer):page.get_by_role("dialog",name="System Message").get_by_role("button",name=answer,exact=True).tap()
            def capture(name):
                # Chromium fades a touch highlight from the launching tile after the dialog opens.
                page.wait_for_timeout(500)
                page.screenshot(path=str(a.evidence/name),animations="disabled")
            def choose_site(d):
                fields=d.locator(".site-fields button");fields.first.tap()
                button(site["plantName"],d.locator(".site-tables").first).tap()
                fields.nth(1).tap();button(site["centerName"],d.locator(".site-tables table").nth(1)).tap()
            if a.api_only:put(end+"plant/plant",site_body(first))
            else:
                page.goto(base);button("설정").tap();tile("plant").tap();d=page.locator(".site-dialog")
                expect(d.locator(".site-fields button").first).to_contain_text("NONE")
                choose_site(d);button("저장",d).tap();prompt("아니오");button("취소",d).tap()
                assert "plant" in status()["missing"];tile("plant").tap();choose_site(d)
                capture("prelogin-plant.png")
                button("저장",d).tap();prompt("예");expect(d).not_to_be_visible()
                tile("plant").tap();expect(d.locator(".site-fields button").nth(1)).to_contain_text(site["centerName"]);button("취소",d).tap()
            assert status()["groupCenter"] is False and set(["machine","popId","process","warehouse"]).issubset(status()["missing"])
            assert "plant" not in status()["missing"] and "plant" in other.request.get(status_url).json()["missing"]
            assert req.get(end+"popId/equipment").status==409
            pv=req.get(process).json();assert [pv["plant"],pv["center"]]==["P1B","003"],pv
            put(process,{"plant":"P1B","center":"003","expectedVersion":pv["version"],"slots":{"1":pv["rows"][0]["code"]}})
            if not a.api_only:
                page.reload();button("설정").tap()
            pop=view("popId");pop_row=pop["popRows"][0]
            if a.api_only:put(end+"popId/equipment/pop-id",{**scope_body(pop),"number":pop_row["code"]})
            else:
                tile("popId").tap();d=page.locator(".popid-dialog")
                d.get_by_role("checkbox",name=pop_row["name"]).check();button("저장",d).tap();prompt("아니오");button("닫기",d.locator("footer")).tap()
                assert "popId" in status()["missing"]
                tile("popId").tap();d.get_by_role("checkbox",name=pop_row["name"]).check()
                capture("prelogin-pop-id.png")
                button("저장",d).tap();prompt("예");expect(d).not_to_be_visible()
                tile("popId").tap();expect(d.get_by_role("checkbox",name=pop_row["name"])).to_be_checked();button("닫기",d.locator("footer")).tap()
            machines=view("machine");m=next(r for r in machines["machines"] if r["code"]=="M02")
            assert req.put(end+"machine/equipment/machines",data={**scope_body(machines),"machines":["000000",m["code"]]}).status==422
            if a.api_only:put(end+"machine/equipment/machines",{**scope_body(machines),"machines":[m["code"]]})
            else:
                tile("machine").tap();d=page.get_by_role("dialog",name="설비 설정",exact=True)
                d.get_by_role("checkbox",name=m["name"]).check();button("저장",d).tap();prompt("아니오");button("취소",d).tap()
                assert "machine" in status()["missing"]
                tile("machine").tap();d.get_by_role("checkbox",name=m["name"]).check()
                capture("prelogin-machines.png")
                button("저장",d).tap();prompt("예");expect(d).not_to_be_visible()
                tile("machine").tap();expect(d.get_by_role("checkbox",name=m["name"])).to_be_checked();button("취소",d).tap()
            assert view("machine")["saved"]["machines"]==[m["code"]]
            assert next(r for r in view("popId")["popRows"] if r["code"]==pop_row["code"])["owner"]=="DEMO-A"
            assert req.put(end+"machine/equipment/machines",data={**scope_body(machines),"machines":["M01"]}).status==409
            req.get(warehouse)
            grant=req.post(warehouse+"/entry",data={"password":password});assert grant.ok,(grant.status,grant.text());g=grant.json()
            member=g["saved"]["roles"];member={k:[] for k in member};member["good"]=[g["rows"][0]["code"]]
            sel=put(warehouse+"/selection",{"expectedVersion":g["version"],"entry":g["entry"],"roles":member}).json()
            put(warehouse+"/priority",{"expectedVersion":sel["version"],"entry":sel["entry"],"roles":member})
            assert status()["ready"],status()
            saved=ctx.storage_state()
        ctx.close()
        with server(a.jar.resolve(),folder,port,password) as base:
            fresh=browser.new_context(storage_state=saved,has_touch=True,viewport={"width":a.width,"height":a.height});req=fresh.request
            assert req.get(status_url).json()["ready"]
            assert req.get(end+"machine/equipment").json()["saved"]["machines"]==["M02"]
            assert req.get(end+"popId/equipment").json()["saved"]["popId"]=="DEMO-A"
            auth=req.post(base+"/api/pop/session",data={"terminalId":"DEMO-A","method":"scan","identifier":"0000"})
            assert auth.ok,(auth.status,auth.text());ident=auth.json()
            assert ident["workCenterCode"]=="003" and 1 in ident["processSlots"],ident
            path=base+"/api/pop/admin/terminal-settings/DEMO-A/equipment"
            snapshot=req.get(path).json();assert snapshot["site"]["plant"]=="P1B" and snapshot["applied"]["machines"]==["M02"] and snapshot["applied"]["popId"]=="DEMO-A",snapshot
            if not a.api_only:
                p=fresh.new_page();p.goto(base)
                expect(p.locator(".workplace-equipment-dock nav button")).to_have_count(1)
                expect(p.locator(".workplace-equipment-dock nav button")).to_contain_text(m["name"])
                p.screenshot(path=str(a.evidence/"prelogin-applied-dock.png"))
            # A later admin save in this browser must also be visible before the next login.
            changed=req.put(path+"/machines",data={"expectedVersion":snapshot["version"],"machines":["M01"]})
            assert changed.ok,(changed.status,changed.text())
            snapshot=req.get(path).json()
            changed=req.put(path+"/pop-id",data={"expectedVersion":snapshot["version"],"number":"POP02"})
            assert changed.ok,(changed.status,changed.text())
            after=req.get(end+"machine/equipment").json()
            assert after["saved"]["machines"]==["M01"]
            assert next(r for r in req.get(end+"popId/equipment").json()["popRows"] if r["code"]=="POP02")["owner"]=="DEMO-A"
            assert req.get(path).json()["applied"]["machines"]==["M02"]
            # A new anonymous browser has none of this station's settings.
            assert "plant" in other.request.get(status_url).json()["missing"]
            r=req.get(end+"plant/equipment").json()
            assert req.put(end+"plant/plant",data=site_body(r)).ok
            final=req.get(status_url).json()
            assert set(["machine","popId","process","warehouse"]).issubset(final["missing"]) and not final["ready"]
            result={"width":a.width,"height":a.height,"anonymousSetup":True,"cancelAndReopen":not a.api_only,"appliedAfterRestart":True,"otherBrowserIsolated":True,"sameSiteReset":True,"adminFollowupVisible":True,"workDock":not a.api_only}
            (a.evidence/"prelogin-site-equipment.json").write_text(json.dumps(result,indent=2),"utf-8")
            print(result)
        browser.close()
if __name__=="__main__":main()
