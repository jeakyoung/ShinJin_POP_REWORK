"""Physical keyboard recovery after closing a nested location scan or canceling a preset."""
import uuid
from playwright.sync_api import expect


def verify_focus(browser,base,terminal,date,digits,size,capture):
    ctx=browser.new_context(has_touch=True,viewport=dict(width=size[0],height=size[1]))
    api=ctx.request;assert api.post(base+"/api/pop/session",data=dict(method="scan",identifier="0000",terminalId=terminal)).ok
    url=base+"/api/pop/work-baskets";headers={"X-Pop-Process-Slot":"1","X-Pop-Work-Code":"001"}
    def view():return api.get(url,headers=headers).json()
    page=ctx.new_page();page.set_default_timeout(6000);errors=[];failures=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    btn=lambda scope,name:scope.get_by_role("button",name=name,exact=True)
    dialog=lambda name:page.get_by_role("dialog",name=name,exact=True)
    def enter():
        btn(page,"생산").tap();page.locator("button[data-view=basket]").first.tap()
    page.goto(base);enter()
    reader=dialog("ComOrderNoScan").get_by_role("textbox");reader.fill("BASKTEST000"+digits+"0001");reader.press("Enter")
    board=page.get_by_role("region",name="작업 장바구니")
    master=board.get_by_role("checkbox",name=date+"/1 선택",exact=True)
    add=btn(board,"투입자재 추가");picker=dialog("투입자재 위치 선택")
    add.tap();btn(picker,"WAREHOUSE-DEMO BIN-DEMO 추가").tap();btn(picker,"적용").tap()
    main=board.get_by_role("table",name="투입자재 목록")
    expect(main.locator("tbody tr")).to_have_count(1)
    add.tap();btn(picker,"WAREHOUSE-DEMO BIN-02 추가").tap()
    qty=btn(picker,"BIN-02 투입수량")
    expect(qty).to_have_text("1")
    btn(picker,"스캔으로 수량 추가하기").tap()
    inline=picker.get_by_role("textbox",name="투입자재 스캔")
    page.keyboard.type("QA");expect(inline).to_have_value("QA")
    loc=dialog("Location 바코드를 스캔하세요.")
    def restore_inline(label):
        if inline.count()!=1:
            failures.append(label+" hid the inline reader")
            btn(picker,"스캔으로 수량 추가하기").tap()
        if not inline.evaluate("e=>e===document.activeElement"):
            failures.append(label+" did not restore keyboard focus")
            inline.focus()
        expect(inline).to_have_value("QA")
    btn(picker,"위치 바코드 스캔").tap()
    field=loc.get_by_role("textbox")
    expect(field).to_be_focused();page.keyboard.type("UNKNOWN");page.keyboard.press("Enter")
    warning=dialog("안내");expect(warning).to_contain_text("등록되지 않은 Location")
    btn(warning,"확인").tap();expect(field).to_be_focused();expect(field).to_have_value("")
    # Use the active keyboard target without refocusing any field.
    page.keyboard.type("BASK-LOC-01");page.keyboard.press("Enter")
    expect(loc).to_have_count(0);expect(picker.locator(".pl-location-name")).to_have_text("A-01")
    restore_inline("successful location lookup")
    btn(picker,"위치 바코드 스캔").tap();page.keyboard.type("PARTIAL");btn(loc,"닫기").tap()
    expect(picker.locator(".pl-location-name")).to_have_count(0)
    expect(picker.locator(".pl-left tbody tr")).to_have_count(4)
    expect(qty).to_have_text("1");restore_inline("canceled location lookup")
    page.keyboard.type("00000002");page.keyboard.press("Enter")
    expect(btn(picker,"BIN-04 투입수량")).to_have_text("1");expect(inline).to_have_value("");expect(inline).to_be_focused()
    if capture:page.screenshot(path=capture/(terminal+"-location-parent.png"))
    btn(picker.locator("footer"),"닫기").tap()
    expect(main.locator("tbody tr")).to_have_count(1);expect(main.locator("tbody td").nth(6)).to_have_text("1")
    expect(master).to_be_checked();assert not view()["groups"]
    # An earlier dataset stores its returned lot and its display metadata separately.
    snapshot=view();p=dict(date=date,sequence=1)
    def post(action,selected=None,issues=None,returns=None):
        return api.post(url+"/commands",headers=headers,data=dict(action=action,visible=[p],selected=selected or [],issues=issues or [],
                returns=returns or [],requestId=str(uuid.uuid4()),expectedRevision=view()["revision"]))
    lot=snapshot["returnCandidates"][0]
    assert post("SAVE_BASKET",[p],[dict(lot=snapshot["materials"][0]["lot"],quantity=1)],
                [dict(lot=lot,length=n,quantity=i+1) for i,n in enumerate((200,350))]).ok
    assert post("START_BASKET").ok
    btn(page,"메뉴 복귀").tap();enter();master.check()
    active=board.get_by_role("region",name="작업 중 반납자재")
    length=lambda i:btn(active,"반납길이 "+str(i)+"행")
    before=view();old=before["groups"][0]["productionReturns"]
    length(2).tap();pad=page.locator("dialog:has(.cn-apply)")
    btn(pad,"750").tap();btn(pad,"취소").tap()
    expect(active).to_be_visible();expect(length(1)).to_be_enabled();expect(length(2)).to_have_text("350")
    snapshot=view();assert snapshot["revision"]==before["revision"]+1
    new=snapshot["groups"][0]["productionReturns"]
    keys=lambda rows:[(r["sequence"],r["line"]["lot"],r["line"]["length"],r["line"]["quantity"],
                       r["material"]["qualityName"],r["material"]["thickness"],r["material"]["width"]) for r in rows]
    if keys(old)!=keys(new):failures.append("cancel changed a persisted lot, quantity or visible material")
    if not length(1).evaluate("e=>e===document.activeElement"):failures.append("rebound length column lost focus")
    if capture:page.screenshot(path=capture/(terminal+"-length-cancel.png"))
    assert not errors,errors
    ctx.close()
    assert not failures,failures
    print("PASS",terminal,"location error retry, success/cancel to partial inline LOT, outer cancel, persisted preset cancel, lot and focus")
