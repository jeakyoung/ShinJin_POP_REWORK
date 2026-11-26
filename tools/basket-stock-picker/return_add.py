"""Trace the two native return queries, transient rows and pre-/post-start returnSave."""
import uuid
from playwright.sync_api import expect


def verify_return_add(browser,base,terminal,date,digits,size,capture):
    ctx=browser.new_context(has_touch=True,viewport=dict(width=size[0],height=size[1]))
    api=ctx.request
    assert api.post(base+"/api/pop/session",data=dict(method="scan",identifier="0000",terminalId=terminal)).ok
    url=base+"/api/pop/work-baskets";headers={"X-Pop-Process-Slot":"1","X-Pop-Work-Code":"001"}
    def view():return api.get(url,headers=headers).json()
    def group():return view()["groups"][0]
    page=ctx.new_page();page.set_default_timeout(7000)
    errors=[];lookups=[];writes=[]
    page.on("pageerror",lambda err:errors.append(str(err)))
    def track(req):
        if "/return-lookup/" in req.url:lookups.append(req.post_data_json)
        elif req.url.endswith("/commands"):writes.append(req.post_data_json)
    page.on("request",track)
    button=lambda scope,name:scope.get_by_role("button",name=name,exact=True)
    dialog=lambda name:page.get_by_role("dialog",name=name,exact=True)
    page.goto(base)
    def enter():
        button(page,"생산").tap();page.locator("button[data-view=basket]").first.tap()
    enter()
    scan=dialog("ComOrderNoScan").get_by_role("textbox")
    scan.fill("BASKTEST000"+digits+"0001");scan.press("Enter")
    board=page.get_by_role("region",name="작업 장바구니")
    plus=button(board,"반납자재 추가");pad=page.locator("dialog:has(.cn-apply)")
    info=dialog("작업 안내")
    table=board.get_by_role("table",name="반납자재 목록")
    rows=table.locator("tbody tr")
    master=board.get_by_role("checkbox",name=date+"/1 선택",exact=True)
    def apply_length(value):
        button(pad,str(value)).tap();button(pad,"적용").tap()
        expect(pad).to_have_count(0);expect(plus).to_be_enabled()
    def material(position):
        button(board,"투입자재 추가").tap()
        popup=dialog("투입자재 위치 선택")
        button(popup,"WAREHOUSE-DEMO "+position+" 추가").tap();button(popup,"적용").tap()
    def ack():button(info,"확인").tap()
    plus.tap();expect(info).to_contain_text("투입자재가 없습니다");ack()
    assert not lookups
    material("BIN-DEMO");plus.tap();expect(pad).to_be_visible()
    button(pad,"적용").tap();expect(pad).to_be_visible()
    if capture:page.screenshot(path=capture/(terminal+"-length-preset.png"))
    button(pad,"취소").tap();expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("S45C")
    assert rows.first.get_by_role("checkbox").is_checked()
    assert len(lookups)==1 and not writes
    expect(button(board,"반납길이 1행")).to_have_text("0")
    expect(rows.first).to_have_attribute("aria-current","true")
    expect(button(board,"반납길이 1행")).to_be_focused()
    button(board,"반납수량 1행").tap();button(pad,"취소").tap();expect(button(board,"반납수량 1행")).to_have_text("1")
    button(board,"반납수량 1행").tap();button(pad,"적용").tap();expect(button(board,"반납수량 1행")).to_have_text("0")
    assert len(lookups)==1 and not writes
    button(board,"장바구니 담기").tap();expect(info).to_contain_text("길이");ack()
    button(board,"반납길이 1행").tap();apply_length(200)
    assert lookups[-1]["length"]==200 and not writes and not view()["groups"]
    button(board,"장바구니 담기").tap();ack()
    saved=group()
    assert len(saved["returns"])==1 and saved["returns"][0]["lot"]["lot"]==""
    assert saved["returns"][0]["lot"]["item"]=="ITEM-DEMO" and saved["returns"][0]["material"]["qualityName"]=="S45C"
    plus.tap();apply_length(250)
    assert writes[-1]["action"]=="SAVE_RETURN_GRID"
    assert [r["line"]["length"] for r in group()["productionReturns"]]==[200,250]
    assert [r["length"] for r in group()["returns"]]==[200]
    button(page,"메뉴 복귀").tap();enter();master.check()
    expect(table.locator("tbody tr")).to_have_count(1)
    button(board,"작업 시작").tap();ack()
    assert [r["line"]["length"] for r in group()["productionReturns"]]==[200]
    # Native 7x7 (and 3x3) use the focused order's dimensions, not the first issue.
    fallback_position="BIN-03" if terminal=="DEMO-A" else "BIN-04"
    material(fallback_position)
    plus.tap();apply_length(300)
    expect(rows).to_have_count(3)
    expect(rows.nth(1)).to_contain_text("반납-01")
    expect(rows.nth(2)).to_contain_text("반납-02")
    assert [rows.nth(2).locator("td").nth(i).inner_text() for i in (4,5)]==["2","80"]
    assert looks_at(lookups[-1],"BIN-DEMO",fallback_position) and len(group()["productionReturns"])==1
    button(board,"반납길이 2행").tap();apply_length(350)
    running=group()["productionReturns"]
    assert [(r["sequence"],r["line"]["length"]) for r in running]==[(1,200),(2,350),(3,300)],running
    assert [r["line"]["quantity"] for r in running]==[0,1,1]
    cmd=writes[-1]
    repeat=api.post(url+"/commands",headers=headers,data=cmd)
    assert repeat.ok
    stale=api.post(url+"/commands",headers=headers,data={**cmd,"requestId":str(uuid.uuid4())})
    assert stale.status==409 and len(group()["productionReturns"])==3
    button(page,"메뉴 복귀").tap();enter();master.check()
    active=board.get_by_role("region",name="작업 중 반납자재")
    expect(active.get_by_role("checkbox")).to_have_count(3)
    expect(button(active,"반납길이 3행")).to_have_text("300")
    button(active,"반납길이 3행").tap();apply_length(400)
    edited=group()["productionReturns"][2]
    assert edited["material"]["thickness"]==2 and edited["material"]["width"]==80
    assert edited["line"]["lot"]["position"]=="BIN-RETURN-02" and edited["line"]["length"]==400
    if capture:page.screenshot(path=capture/(terminal+"-running-returns.png"))
    assert not errors,errors
    ctx.close()
    print("PASS",terminal,"return +, empty input, zero/cancel, 014/015, defaults, preset, stage, group returnSave, START copy, focused fallback, multiple positions, retry/re-entry")


def looks_at(request,first,focused):
    return request["firstIssue"]["position"]==first and request["focusedIssue"]["position"]==focused
