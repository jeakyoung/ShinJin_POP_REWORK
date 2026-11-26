"""Test the three local printer roles and eight connection-profile keys using a private demo JVM."""
import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[2]
LABELS={"ftpHost":"FTP 주소","ftpPort":"FTP 포트","imagePath":"이미지 경로","updatePath":"파일 경로",
        "version":"FTP 프로필 버전","dbHost":"DB 주소","dbPort":"DB 포트","database":"DB명"}
PROFILE=dict(ftpHost="terminal.example.invalid",ftpPort="2021",imagePath="/sample-images/",updatePath="/sample-updates/",
             version="26.11.2",dbHost="store.example.invalid",dbPort="11433",database="POP_FIXTURE")
ROLES={"작업지시서 프린터":"A-DOC2","거래명세서 프린터":"A-SHIP","라벨 프린터":"A-LABEL"}
OUTPUTS=dict(document="A-DOC2",shipment="A-SHIP",label="A-LABEL")

@contextmanager
def server(jar,directory,port,missing=False):
    static=(ROOT/"src/web/dist").as_uri()+"/"
    base="http://127.0.0.1:"+str(port)
    font=os.environ.get("POP_QA_KOREAN_FONT")
    if not font and os.name=="nt":font=str(Path(os.environ["WINDIR"])/"Fonts/malgun.ttf")
    if not font or not Path(font).is_file():raise RuntimeError("Set POP_QA_KOREAN_FONT to the Korean TTF used for work-order reports")
    cmd=[str(Path(os.environ["JAVA_HOME"])/"bin"/("java.exe" if os.name=="nt" else "java")),"-jar",str(jar),
         "--server.address=127.0.0.1","--server.port="+str(port),"--spring.profiles.active="+("demo,prelogin-test" if missing else "demo"),
         "--shinjin.demo.work-print-font="+font,"--shinjin.demo.output-font="+font,
         "--shinjin.prelogin.missing="+("ftp,db,printer" if missing else ""),"--spring.web.resources.static-locations="+static,
         "--shinjin.prelogin.local-store="+str(directory/"local.json")]
    with (directory/"server.log").open("wb") as log:
        proc=subprocess.Popen(cmd,cwd=directory,stdout=log,stderr=log)
        try:
            for _ in range(160):
                if proc.poll() is not None:raise RuntimeError((directory/"server.log").read_text(errors="replace")[-3500:])
                try:
                    with urllib.request.urlopen(base+"/api/pop/context"):break
                except OSError:time.sleep(.25)
            yield base
        finally:
            proc.terminate();proc.wait(20)

def second_site(api,base):
    printer=base+"/api/pop/prelogin-details/DEMO-B/printer"
    version=api.get(printer).json()["revision"]
    chosen=dict(document="B-DOC",shipment="B-DOC2",label="B-SHIP")
    assert api.put(printer,data=dict(expectedVersion=version,outputs=chosen)).ok
    assert api.post(base+"/api/pop/session",data=dict(method="manual",identifier="DEMO-W03",passcode="demo-only",terminalId="DEMO-B")).ok
    packing=base+"/api/pop/packing"
    r=next(row for row in api.get(packing).json() if row["allowedMaterial"])
    def pack(action,row,pieces):
        response=api.post(packing+"/commands",data=dict(requestId=str(uuid.uuid4()),operatorId="DEMO-W03",action=action,
            members=[dict(key=row["key"],version=row["version"],pieces=pieces)],autoLabel=True))
        assert response.ok,response.text()
        return response.json()
    started=pack("STANDARD_PACK_START",r,[])
    current=next(row for row in started["rows"] if row["key"]==r["key"])
    remaining=current["orderedQty"]
    pieces=[]
    for stock in api.get(packing+"/stock",params=dict(key=r["key"])).json():
        amount=min(remaining,stock["qty"])
        if amount>0:
            pieces.append({**{k:stock[k] for k in ("lot","warehouse","location","item")},"qty":amount})
            remaining-=amount
    assert remaining==0
    finished=pack("STANDARD_PACK_FINISH",current,pieces)
    assert finished["labels"] and all(label["role"]=="Printer3" and label["device"]==chosen["label"] for label in finished["labels"])
    shipping=base+"/api/pop/shipping"
    handoff=next(row for row in api.get(shipping).json()["rows"] if row["handoff"]["packingRef"]==r["key"])
    confirmed=api.post(shipping+"/commands",data=dict(handoffId=handoff["handoff"]["id"],action="CONFIRM",
        expectedVersion=handoff["version"],requestId=str(uuid.uuid4()),printChecked=False))
    assert confirmed.ok,confirmed.text()
    selection=dict(numbers=[confirmed.json()["shipment"]["number"]])
    preview=api.post(shipping+"/documents/preview",data=selection)
    assert preview.ok and preview.json()["device"]==chosen["shipment"],preview.text()
    assert api.post(shipping+"/documents/pdf",data=selection).body().startswith(b"%PDF-")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("jar",type=Path);parser.add_argument("--capture",type=Path)
    args=parser.parse_args()
    if args.capture:args.capture.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary,sync_playwright() as pw,socket.socket() as sock:
        sock.bind(("127.0.0.1",0));port=sock.getsockname()[1];sock.close()
        jar=args.jar.resolve();directory=Path(temporary)
        b=pw.chromium.launch(channel="chrome")
        ctx=b.new_context(has_touch=True,viewport={"width":1024,"height":768})
        page=ctx.new_page();page.set_default_timeout(9000)
        errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
        def button(target,name):return target.get_by_role("button",name=name,exact=True)
        def dialog(name):return page.get_by_role("dialog",name=name,exact=True)
        with server(jar,directory,port,missing=True) as base:
            api=ctx.request
            prefix=base+"/api/pop/prelogin-details/DEMO-A/"
            status=base+"/api/pop/prelogin-settings?terminalId=DEMO-A"
            auth=base+"/api/pop/session"
            login=dict(method="manual",identifier="DEMO-W01",passcode="demo-only",terminalId="DEMO-A")
            assert api.post(auth,data=login).status==409
            page.goto(base);button(page,"설정").tap()
            hub=dialog("환경설정")
            def open_section(name):
                hub.locator("button[data-setting="+name+"]").tap()
                return dialog("프린터 설정" if name=="printer" else "정보 확인")
            def answer(value):button(dialog("System Message"),value).tap()
            printbox=open_section("printer")
            button(printbox,"A-DOC2").tap()
            expect(dialog("System Message")).to_contain_text("터치해 주세요");answer("확인")
            button(printbox,"저장").tap();expect(dialog("System Message")).to_contain_text("작업지시서");answer("확인")
            for index,(name,value) in enumerate(ROLES.items()):
                button(printbox,name).tap();button(printbox,value).tap()
                if index<2:
                    button(printbox,"저장").tap()
                    expect(dialog("System Message")).to_contain_text(list(ROLES)[index+1]);answer("확인")
            button(printbox,"저장").tap();answer("아니오")
            button(printbox,"취소").tap()
            p=open_section("printer")
            assert all(button(p,name).inner_text()=="NONE" for name in ROLES)
            for name,value in ROLES.items():button(p,name).tap();button(p,value).tap()
            if args.capture:page.screenshot(path=args.capture/"prelogin-printer-1024.png")
            button(p,"저장").tap();answer("예")
            expect(p).to_have_count(0)
            assert api.get(prefix+"printer").json()["outputs"]==OUTPUTS
            assert "printer" not in api.get(status).json()["missing"]
            assert api.post(auth,data=login).status==409
            info=open_section("info")
            expect(info.get_by_role("textbox",name="DB 주소")).to_have_value("")
            for key,label in LABELS.items():info.get_by_role("textbox",name=label,exact=True).fill(PROFILE[key])
            button(info,"취소").tap()
            info=open_section("info");expect(info.get_by_role("textbox",name="FTP 주소")).to_have_value("")
            for key,label in LABELS.items():info.get_by_role("textbox",name=label,exact=True).fill(PROFILE[key])
            if args.capture:page.screenshot(path=args.capture/"prelogin-info-1024.png")
            button(info,"저장").tap();answer("예");expect(info).to_have_count(0)
            read=api.get(prefix+"info").json();assert read["profile"]==PROFILE
            assert api.get(status).json()["ready"] and api.get(status).json()["version"]==PROFILE["version"]
            assert api.put(prefix+"info",data=dict(expectedVersion=0,profile=PROFILE)).status==409
            assert api.put(prefix+"printer",data=dict(expectedVersion=read["revision"],outputs={**OUTPUTS,"document":"invalid"})).status==422
            assert api.put(prefix+"info",data=dict(expectedVersion=read["revision"],profile={**PROFILE,"dbHost":"user@host"})).status==422
            assert api.get(base+"/api/pop/admin/terminal-settings/DEMO-A").status==401
            cookie=ctx.storage_state()
        with server(jar,directory,port) as base:
            new=b.new_context(storage_state=cookie,has_touch=True);api=new.request
            assert api.get(prefix+"info").json()["profile"]==PROFILE
            assert api.get(prefix+"printer").json()["outputs"]==OUTPUTS
            restored=new.new_page()
            for width,height in ((1280,800),(1366,768),(1920,1080)):
                restored.set_viewport_size(dict(width=width,height=height));restored.goto(base)
                button(restored,"설정").tap()
                menu=restored.get_by_role("dialog",name="환경설정")
                for section,label in (("printer","프린터 설정"),("info","정보 확인")):
                    menu.locator("button[data-setting="+section+"]").tap()
                    form=restored.get_by_role("dialog",name=label,exact=True)
                    if section=="info":
                        for key,field in LABELS.items():expect(form.get_by_role("textbox",name=field,exact=True)).to_have_value(PROFILE[key])
                    else:
                        for name,value in ROLES.items():expect(button(form,name)).to_have_text(value)
                    for item in form.locator("button:enabled,input:enabled").all():
                        item.scroll_into_view_if_needed()
                        hit=item.evaluate("""el=>{const r=el.getBoundingClientRect();return [[.1,.1],[.9,.1],[.1,.9],[.9,.9]].every(([x,y])=>el.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)))}""")
                        assert hit,(width,section,item.get_attribute("aria-label") or item.inner_text())
                    if args.capture:restored.screenshot(path=args.capture/("prelogin-"+section+"-"+str(width)+".png"))
                    button(form,"취소").tap()
            other=b.new_context()
            unchanged=other.request.get(prefix+"printer").json()
            assert all(v=="NONE" for v in unchanged["outputs"].values())
            assert other.request.get(prefix+"info").json()["profile"]!=PROFILE
            bprefix=prefix.replace("DEMO-A","DEMO-B")
            assert all(x=="NONE" for x in api.get(bprefix+"printer").json()["outputs"].values())
            assert api.get(bprefix+"info").json()["profile"]!=PROFILE
            assert api.post(auth,data=login).ok
            admin=base+"/api/pop/admin/terminal-settings/DEMO-A"
            def state():return api.get(admin).json()["view"]
            assert state()["applied"]["values"]["outputs"]==OUTPUTS
            printapi=base+"/api/pop/work-print"
            options=api.get(printapi+"/options").json()
            query=dict(start=options["today"],end=options["today"],center="000",complete="미완료",printed="미출력",
                closed=False,drawing=False,operator="",materials=[x[0] for x in options["materials"]],accounts=["제품","상품","교환","자재"])
            result=api.post(printapi+"/search",data=query)
            assert result.ok,result.text()
            rows=result.json();assert rows,"Work print fixture produced no rows"
            document=api.post(printapi+"/preview",data=dict(key=str(uuid.uuid4()),form="Multiple",rows=[rows[0]["key"]]))
            assert document.ok and document.json()["device"]==OUTPUTS["document"],document.text()
            assert api.get(printapi+"/preview/"+document.json()["id"]+"/pdf").body().startswith(b"%PDF-")
            assert api.post(printapi+"/preview/"+document.json()["id"]+"/submit",data=dict(key=document.json()["submitKey"])).status==403
            latest=api.get(prefix+"printer").json()
            change={**OUTPUTS,"document":"A-DOC"}
            assert api.put(prefix+"printer",data=dict(expectedVersion=latest["revision"],outputs=change)).ok
            assert state()["applied"]["values"]["outputs"]==OUTPUTS and state()["saved"]["values"]["outputs"]==change
            assert api.post(auth+"/logout",data={}).ok
            assert api.post(auth,data=login).ok
            assert state()["applied"]["values"]["outputs"]==change
            s=state()
            assert api.put(admin+"/printers",data=dict(expectedVersion=s["saved"]["version"],printerVersion=s["printerVersion"],outputs=OUTPUTS)).ok
            assert api.get(prefix+"printer").json()["outputs"]==OUTPUTS and state()["applied"]["values"]["outputs"]==change
            assert api.post(admin+"/refresh",data={}).ok and state()["applied"]["values"]["outputs"]==OUTPUTS
            second_site(other.request,base)
            assert not errors,errors
            new.close();other.close()
        ctx.close();b.close()
        print("PASS prelogin touch, cancel, 3 printer roles, 8 profile fields, stale update, JVM restart, browser/terminal isolation, login pin, work-order PDF, shipping statement PDF and simulated packing label")

if __name__=="__main__":main()
