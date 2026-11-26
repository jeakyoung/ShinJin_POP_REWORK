"""Parent-grid deletion and re-entry through the real frmProcess3 menu."""
import uuid

from playwright.sync_api import expect


def verify_reentry(browser, base, terminal, date, digits, size, capture):
    context=browser.new_context(has_touch=True,viewport=dict(width=size[0],height=size[1]))
    api=context.request
    assert api.post(base+"/api/pop/session",data=dict(method="scan",identifier="0000",terminalId=terminal)).ok
    url=base+"/api/pop/work-baskets"
    headers={"X-Pop-Process-Slot":"1","X-Pop-Work-Code":"001"}
    def view():return api.get(url,headers=headers).json()
    def group():return view()["groups"][0]
    page=context.new_page()
    errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.set_default_timeout(6000)
    def button(scope,name):return scope.get_by_role("button",name=name,exact=True)
    def dialog(name):return page.get_by_role("dialog",name=name,exact=True)
    page.goto(base)
    def enter():
        button(page,"생산").tap()
        page.locator("button[data-view=basket]").first.tap()
    enter()
    reader=dialog("ComOrderNoScan").get_by_role("textbox")
    reader.fill("BASKTEST000"+digits+"0001");reader.press("Enter")
    board=page.get_by_role("region",name="작업 장바구니")
    grid=board.get_by_role("table",name="투입자재 목록")
    cells=grid.locator("tbody tr")
    check=board.get_by_role("checkbox",name=date+"/1 선택",exact=True)
    info=dialog("작업 안내")
    notice=lambda:button(info,"확인").tap()
    choices=dialog("투입자재 위치 선택")
    button(board,"투입자재 추가").tap()
    for place in ["BIN-DEMO","BIN-02","BIN-03","BIN-04","BIN-04"]:
        button(choices,"WAREHOUSE-DEMO "+place+" 추가").tap()
    button(choices,"적용").tap()
    expect(cells).to_have_count(4)
    for length in [120,140]:
        button(board,"반납자재 추가").tap()
        add=dialog("반납자재 선택")
        add.get_by_role("combobox").select_option("0")
        add.get_by_role("textbox",name="반납수량",exact=True).fill("1")
        add.get_by_role("textbox",name="반납길이",exact=True).fill(str(length))
        button(add,"적용").tap()
    button(board,"장바구니 담기").tap();notice()
    initial=group()
    pairs=list(zip(initial["issueSequences"],initial["issues"]))
    assert len(pairs)==4 and sum(r["quantity"] for _,r in pairs)==5
    assert [r["lot"]["position"] for _,r in pairs]==["BIN-DEMO","BIN-02","BIN-03","BIN-04"]
    board.get_by_role("checkbox",name="반납자재 1 선택",exact=True).check()
    button(board,"반납자재 삭제").tap();button(dialog("확인"),"예").tap();notice()
    assert group()["returnSequences"]==[2] and group()["returns"][0]["length"]==140

    basket=button(board,initial["id"])
    popup=dialog("장바구니 자재")
    basket.tap()
    expect(popup.locator("tbody tr")).to_have_count(4)
    expect(popup).to_contain_text("BIN-04")
    popup.get_by_role("tab",name="반납자재").tap()
    expect(popup.locator("tbody tr")).to_have_count(1)
    button(popup,"닫기").tap()
    expect(board.get_by_role("table",name="반납자재 목록").locator("tbody tr")).to_have_count(1)
    basket.tap();popup.get_by_role("tab",name="반납자재").tap();button(popup,"초기화").tap()
    ask=dialog("자재 초기화 확인");button(ask,"아니오").tap()
    assert len(group()["returns"])==1
    button(popup,"초기화").tap();button(ask,"예").tap()
    expect(popup).to_have_count(0)
    expect(board.get_by_role("table",name="반납자재 목록").locator("tbody tr")).to_have_count(1)
    assert group()["returns"]==[]

    def reenter(expected):
        button(page,"메뉴 복귀").tap();enter()
        expect(check).not_to_be_checked()
        expect(cells).to_have_count(0)
        check.check()
        expect(cells).to_have_count(len(expected))
        assert grid.locator("input:checked").count()==0
        expect(cells.first).to_have_attribute("aria-current","true")
        displayed=[float(r.locator("td").nth(6).inner_text()) for r in cells.all()]
        assert displayed==expected,(displayed,expected)
    reenter([r["quantity"] for _,r in pairs])
    def select(indices):
        for i in indices:cells.nth(i).get_by_role("checkbox").check()
    def remove(answer):
        button(board,"투입자재 삭제").tap()
        q=dialog("확인")
        expect(q).to_contain_text("선택한 투입 자재")
        button(q,answer).tap()
        if answer=="예":
            expect(info).to_contain_text("삭제 되었습니다.")
            notice()
    select([0,2]);remove("아니오")
    assert grid.locator("input:checked").count()==2 and group()["issues"]==initial["issues"]
    remove("예")
    remain=[pairs[1],pairs[3]]
    assert group()["issueSequences"]==[s for s,_ in remain]
    expect(cells).to_have_count(2)
    expect(cells.nth(1)).to_have_attribute("aria-current","true")
    reenter([r["quantity"] for _,r in remain])
    select([0,1]);button(board,"투입자재 삭제").tap()
    expect(info).to_contain_text("1개 이상의 투입자재");notice()
    assert group()["issueSequences"]==[s for s,_ in remain]
    button(board,"작업 시작").tap();notice()
    reenter([r["quantity"] for _,r in remain])
    assert [r["sequence"] for r in group()["productionIssues"]]==[s for s,_ in remain]
    select([0]);remove("예");expect(cells).to_have_count(1)
    assert [r["sequence"] for r in group()["productionIssues"]]==[remain[1][0]]
    assert group()["issues"]==[r for _,r in remain]
    reenter([remain[1][1]["quantity"]])
    select([0]);button(board,"투입자재 삭제").tap()
    expect(info).to_contain_text("1개 이상의 투입자재");notice()
    key=dict(date=date,sequence=1)
    state=view()
    cmd=dict(action="REMOVE_ISSUE_ROWS",visible=[key],selected=[],issues=[],returns=[],groupId=initial["id"],
             requestId=str(uuid.uuid4()),expectedRevision=state["revision"],removal=dict(rows=[remain[1][0]],checked=[0]))
    last=api.post(url+"/commands",headers=headers,data=cmd)
    assert last.status==409 and last.json()["code"]=="LAST_ISSUE_REQUIRED"
    stale=api.post(url+"/commands",headers=headers,data={**cmd,"expectedRevision":state["revision"]-1})
    assert stale.status==409 and stale.json()["code"]=="STALE_REVISION"
    assert view()["revision"]==state["revision"] and not errors,errors
    if capture:page.screenshot(path=capture/(terminal+"-after-reentry.png"))
    cells.first.get_by_role("checkbox").uncheck()
    button(board,"투입자재 추가").tap()
    button(choices,"WAREHOUSE-DEMO BIN-02 추가").tap();button(choices,"적용").tap()
    expect(cells).to_have_count(2)
    expect(button(board,"작업중단")).to_be_enabled()
    assert len(group()["productionIssues"])==2
    select([1]);remove("예")
    expect(cells).to_have_count(1)
    assert len(group()["productionIssues"])==2  # the just-added grid row still carries native MAT_SEQ=0
    reenter([remain[1][1]["quantity"],1])
    select([1]);remove("예")
    assert [r["sequence"] for r in group()["productionIssues"]]==[remain[1][0]]
    # Prepare an independent second work row; all parent grid gestures below use the normal menu.
    second=dict(date=date,sequence=2)
    def stage_second():
        snapshot=view()
        save=dict(action="SAVE_BASKET",requestId=str(uuid.uuid4()),expectedRevision=snapshot["revision"],
                  visible=[second],selected=[second],issues=[dict(lot=pairs[0][1]["lot"],quantity=1)],
                  returns=[dict(lot=snapshot["returnCandidates"][0],quantity=2,length=n) for n in (80,100)])
        res=api.post(url+"/commands",headers=headers,data=save)
        assert res.ok,res.text()
        return res.json()["groupId"]
    second_id=stage_second()
    button(page,"메뉴 복귀").tap();enter()
    button(board,second_id).tap()
    button(popup,"초기화").tap();button(ask,"예").tap()
    expect(popup).to_have_count(0)
    button(board,second_id).tap()
    popup.get_by_role("tab",name="반납자재").tap();button(popup,"초기화").tap();button(ask,"예").tap()
    expect(button(board,second_id)).to_have_count(0)
    master=board.get_by_role("table",name="조회 목록과 작업 선택")
    expect(master.locator("tbody tr").first).to_have_attribute("aria-current","true")
    expect(cells).to_have_count(0)
    assert master.locator("input:checked").count()==0 and len(view()["groups"])==1
    second_id=stage_second()
    start=dict(action="START_BASKET",requestId=str(uuid.uuid4()),expectedRevision=view()["revision"],
               visible=[second],selected=[],issues=[],returns=[])
    assert api.post(url+"/commands",headers=headers,data=start).ok
    button(page,"메뉴 복귀").tap();enter()
    master.get_by_text(second_id,exact=True).tap()
    second_return=board.get_by_role("region",name="작업 중 반납자재")
    second_return.get_by_role("checkbox",name="반납자재 1 선택").check()
    button(board,"반납자재 삭제").tap();button(dialog("확인"),"예").tap();notice()
    second_state=next(g for g in view()["groups"] if g["id"]==second_id)
    assert [r["sequence"] for r in second_state["productionReturns"]]==[2] and len(second_state["returns"])==2
    button(page,"메뉴 복귀").tap();enter()
    master.get_by_text(second_id,exact=True).tap()
    expect(second_return.get_by_role("checkbox")).to_have_count(1)
    expect(button(second_return,"반납수량 2행")).to_have_text("2")
    assert not errors,errors
    context.close()
    print("PASS",terminal,"parent close, per-tab cancel/one-side clear, 4 -> 2 staged -> 1 running, stable keys, row focus, quantities, last-row guard, stale revision")
