"""Exercise frmProcess3 through its production menu with a private synthetic Spring instance."""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "src/api/src/main/resources/demo"


def fixture(directory,return_add=False,shared_clear=False):
    sites = json.loads((DATA / "basket-stock-picker.json").read_text(encoding="utf-8"))
    columns = json.loads((DATA / "basket-plan-columns.json").read_text(encoding="utf-8"))
    menu=json.loads((ROOT/"tools/demo-dataset/process-003-write.json").read_text(encoding="utf-8"))
    for terminal in ("DEMO-A","DEMO-A2"):
        menu["stations"][terminal]["slots"]=[1,2]
        menu["menuProcesses"][terminal]["slots"]["2"]="002"
    (directory/"menu.json").write_text(json.dumps(menu),encoding="utf-8")
    for plan in columns:
        plan["columns"]["quality"] = "014" if return_add and plan["terminal"]=="DEMO-A" else "015"
        if shared_clear and plan["terminal"]=="DEMO-A2" and plan["key"]["sequence"]==2:
            plan["columns"]["length"]=90
    for site in sites:
        prototype = site["stocks"][0]
        for location, number in [("BIN-02", "QA00000001"), ("BIN-03", "QA00000001"), ("BIN-04", "QA00000002")]:
            stock = deepcopy(prototype)
            stock["spec"]["lot"].update(position=location, lot=number)
            stock["spec"]["locationName"] = location
            site["stocks"].append(stock)
        for answer in site["answers"]:
            answer["grades"] = "014,015,019"
            answer["lots"] = [entry["spec"]["lot"] for entry in site["stocks"]]
        site["answers"].append(dict(division="SELECT2", warehouse="001" if site["plant"]=="000001" else "201",
            grades="014,015,019",status="W", thickness=7,width=7,length=7,lots=[site["stocks"][-1]["spec"]["lot"]]))
    for name, data in [("stock-picker",sites),("plan-columns",columns)]:
        (directory / (name+".json")).write_text(json.dumps(data),encoding="utf-8")
    returns=json.loads((DATA/"basket-return-lookup.json").read_text(encoding="utf-8"))
    if return_add:
        for site in sites:
            for stock in site["stocks"]:
                pos=stock["spec"]["lot"]["position"]
                if pos in ("BIN-03","BIN-04"):
                    stock["spec"].update(thickness=3 if pos=="BIN-03" else 7,width=3 if pos=="BIN-03" else 7)
        (directory/"stock-picker.json").write_text(json.dumps(sites),encoding="utf-8")
        fallback=deepcopy(returns[0]);fallback.update(thickness=2,width=80)
        fallback["positions"].append({"code":"BIN-RETURN-02","name":"반납-02"})
        returns.append(fallback)
    (directory/"return-lookup.json").write_text(json.dumps(returns),encoding="utf-8")


def verify(browser, base, terminal, date, digits, size, capture):
    context=browser.new_context(has_touch=True,viewport=dict(width=size[0],height=size[1]))
    api=context.request
    login=dict(method="scan",identifier="0000",terminalId=terminal)
    assert api.post(base+"/api/pop/session",data=login).ok
    endpoint=base+"/api/pop/work-baskets"
    headers={"X-Pop-Process-Slot":"1","X-Pop-Work-Code":"001"}
    def view(): return api.get(endpoint,headers=headers).json()
    def send(command): return api.post(endpoint+"/commands",headers=headers,data=command)
    page=context.new_page()
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.set_default_timeout(6000)
    def button(scope,name):return scope.get_by_role("button",name=name,exact=True)
    def dialog(name):return page.get_by_role("dialog",name=name,exact=True)
    page.goto(base)
    button(page,"생산").tap()
    page.locator('button[data-view=basket]').first.tap()
    reader=dialog("ComOrderNoScan").get_by_role("textbox")
    reader.fill("BASKTEST000"+digits+"0001")
    reader.press("Enter")
    region=page.get_by_role("region",name="작업 장바구니")
    plus=button(region,"투입자재 추가")
    checked=region.get_by_role("checkbox",name=date+"/1 선택",exact=True)
    metric=button(region,"투입자재 두께")
    expect(metric).to_have_text("2")
    metric.tap()
    pad=page.locator("dialog:has(.cn-apply)")
    button(pad,"9").tap();button(pad,"취소").tap()
    expect(metric).to_have_text("2")
    metric.tap();button(pad,"적용").tap()
    expect(metric).to_have_text("")
    plus.tap()
    empty_picker=dialog("투입자재 위치 선택")
    expect(button(empty_picker,"적용")).to_be_enabled()
    expect(empty_picker.locator(".pl-left tbody tr")).to_have_count(0)
    button(empty_picker,"닫기").tap()
    checked.uncheck()
    plus.tap()
    info=dialog("작업 안내")
    expect(info).to_contain_text("적용할 양품")
    button(info,"확인").tap()
    checked.check()
    picker=dialog("투입자재 위치 선택")
    main=region.get_by_role("table",name="투입자재 목록")
    def open_picker():
        plus.tap()
        expect(picker.locator(".pl-left tbody tr")).to_have_count(4)
    def pick(position):
        button(picker,"WAREHOUSE-DEMO "+position+" 추가").tap()
    def apply():
        button(picker,"적용").tap()
        expect(picker).to_have_count(0)
    open_picker()
    pick("BIN-02");button(picker,"닫기").tap()
    expect(main.locator("tbody tr")).to_have_count(0)
    open_picker()
    button(picker,"스캔으로 수량 추가하기").tap()
    scan=picker.get_by_role("textbox",name="투입자재 스캔")
    scan.fill("QA00000001");scan.press("Enter")
    expect(dialog("안내")).to_contain_text("로케이션이 여러개")
    button(dialog("안내"),"확인").tap()
    scan.fill("QA00000002");scan.press("Enter")
    expect(picker.locator(".pl-right tbody tr")).to_have_count(1)
    button(picker,"잔재 추가").tap()
    expect(button(picker,"BIN-04 투입수량")).to_have_text("2")
    button(picker.locator("footer"),"닫기").tap()
    open_picker()
    button(picker,"위치 바코드 스캔").tap()
    loc=page.locator(".pl-location-input input,.pl-location-scan input")
    if not loc.count():loc=page.locator("dialog input:visible").last
    loc.fill("BASK-LOC-01");loc.press("Enter")
    expect(picker.locator(".pl-location-name")).to_have_text("A-01")
    pick("BIN-DEMO")
    if capture:
        page.screenshot(path=capture/(terminal+"-material-picker.png"))
    apply()
    expect(main).to_contain_text("LOT-DEMO")
    assert view()["groups"]==[]
    open_picker();pick("BIN-DEMO");apply()
    expect(main.locator("tbody td").nth(6)).to_have_text("2")
    button(region,"장바구니 담기").tap()
    button(info,"확인").tap()
    group=view()["groups"][0]
    assert len(group["issues"])==1 and group["issues"][0]["quantity"]==2
    assert group["productionIssues"]==[]
    open_picker();pick("BIN-02");pick("BIN-03");apply()
    expect(main.locator("tbody tr")).to_have_count(3)
    expect(button(region,"작업 시작")).to_be_enabled()
    group=view()["groups"][0]
    assert [r["line"]["lot"]["position"] for r in group["productionIssues"]]==["BIN-03"],group
    button(region,"작업 시작").tap()
    button(info,"확인").tap()
    group=view()["groups"][0]
    assert [r["line"]["lot"]["position"] for r in group["productionIssues"]]==["BIN-DEMO"],group
    open_picker();pick("BIN-02");apply()
    expect(button(region,"작업중단")).to_be_enabled()
    group=view()["groups"][0]
    assert [r["sequence"] for r in group["productionIssues"]]==[1,2]
    assert group["productionIssues"][1]["line"]["lot"]["position"]=="BIN-02"
    # The native insert does not set mat_seq back on the new parent-grid row.
    open_picker();pick("BIN-02");apply()
    expect(button(region,"작업중단")).to_be_enabled()
    assert [(r["sequence"],r["line"]["quantity"]) for r in view()["groups"][0]["productionIssues"]]==[(1,2),(2,1),(3,2)]
    main.locator("tbody tr").first.tap()
    open_picker();pick("BIN-DEMO");apply()
    expect(info).to_contain_text("TPR601M 0 INSERT ERROR")
    button(info,"확인").tap()
    assert len(view()["groups"][0]["productionIssues"])==3
    other=browser.new_context()
    assert other.request.post(base+"/api/pop/session",data=login).ok
    key=dict(date=date,sequence=1)
    lot={**group["productionIssues"][1]["line"]["lot"],"position":"BIN-04","lot":"QA00000002"}
    cmd=dict(requestId=str(uuid.uuid4()),expectedRevision=view()["revision"],action="ADD_MANUAL_ISSUE",
        visible=[key],selected=[],issues=[dict(lot=lot,quantity=1)],returns=[],groupId=group["id"],manualSequence=0)
    assert other.request.post(endpoint+"/commands",data=cmd,headers=headers).status==403
    assert api.post(endpoint+"/commands",data=cmd,headers={**headers,"X-Pop-Work-Code":"002"}).status==403
    stale=send({**cmd,"expectedRevision":cmd["expectedRevision"]-1})
    assert stale.status==409 and stale.json()["code"]=="STALE_REVISION"
    accepted=send(cmd)
    assert accepted.ok,accepted.text()
    replay=send(cmd)
    assert replay.ok and replay.json()==accepted.json()
    assert other.request.post(endpoint+"/commands",data=cmd,headers=headers).json()==accepted.json()
    assert len(view()["groups"][0]["productionIssues"])==4
    assert not errors,errors
    other.close();context.close()
    print("PASS",terminal,size,"cancel, barcode ambiguity, unique LOT, remnant, location scan, draft, focus-only insert, START copy, scope, concurrency, replay")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("jar",type=Path)
    parser.add_argument("--capture",type=Path)
    parser.add_argument("--reentry",action="store_true",help="Exercise parent deletion and returning from the production menu")
    parser.add_argument("--return-add",action="store_true",help="Exercise the native return-row and preset length sequence")
    parser.add_argument("--shared-clear",action="store_true",help="Exercise ComBasketAdd with two orders in the same group")
    parser.add_argument("--subform-focus",action="store_true",help="Exercise nested location and return-preset cancellation on a physical keyboard")
    args=parser.parse_args()
    if args.capture:args.capture.mkdir(exist_ok=True,parents=True)
    with tempfile.TemporaryDirectory() as tmp:
        directory=Path(tmp)
        fixture(directory,args.return_add,args.shared_clear)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
        base="http://127.0.0.1:"+str(port)
        java=str(Path(os.environ["JAVA_HOME"])/"bin"/("java.exe" if os.name=="nt" else "java"))
        with (directory/"api.log").open("wb") as log:
            server=subprocess.Popen([java,"-jar",str(args.jar.resolve()),"--server.address=127.0.0.1",
                "--server.port="+str(port),"--spring.profiles.active=demo",
                "--spring.web.resources.static-locations="+(ROOT/"src/web/dist").as_uri()+"/",
                "--shinjin.demo.dataset="+str(directory/"menu.json"),
                "--shinjin.demo.basket-stock-picker="+(directory/"stock-picker.json").as_uri(),
                "--shinjin.demo.basket-return-lookup="+(directory/"return-lookup.json").as_uri(),
                "--shinjin.demo.basket-plan-columns="+(directory/"plan-columns.json").as_uri()],
                cwd=directory,stdout=log,stderr=log)
            try:
                for _ in range(160):
                    if server.poll() is not None:raise RuntimeError((directory/"api.log").read_text(errors="replace"))
                    try:
                        with urllib.request.urlopen(base+"/api/pop/context"):break
                    except OSError:time.sleep(.25)
                with sync_playwright() as pw:
                    browser=pw.chromium.launch(channel="chrome")
                    from reentry import verify_reentry
                    from return_add import verify_return_add
                    from shared_clear import verify_shared_clear
                    from subform_focus import verify_focus
                    run=verify_focus if args.subform_focus else verify_shared_clear if args.shared_clear else verify_return_add if args.return_add else verify_reentry if args.reentry else verify
                    run(browser,base,"DEMO-A","2030-01-01","1",(1280,800),args.capture)
                    run(browser,base,"DEMO-A2","2030-01-02","2",(1024,768),args.capture)
                    browser.close()
            finally:
                server.terminate();server.wait(timeout=20)


if __name__=="__main__":main()
