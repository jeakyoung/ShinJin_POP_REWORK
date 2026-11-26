"""ComBasketAdd when multiple work orders share the selected group and its cells."""
import uuid
from playwright.sync_api import expect


def verify_shared_clear(browser,base,terminal,date,digits,size,capture):
    context=browser.new_context(has_touch=True,viewport=dict(width=size[0],height=size[1]))
    other=browser.new_context()
    login=dict(method="scan",identifier="0000",terminalId=terminal)
    for ctx in (context,other):assert ctx.request.post(base+"/api/pop/session",data=login).ok
    endpoint=base+"/api/pop/work-baskets"
    headers={"X-Pop-Process-Slot":"1","X-Pop-Work-Code":"001"}
    keys=[dict(date=date,sequence=n) for n in (1,2)]
    def view():return context.request.get(endpoint,headers=headers).json()
    def post(api,action,visible,selected=None,issues=None,returns=None,gid=None):
        return api.post(endpoint+"/commands",headers=headers,data=dict(action=action,visible=visible,selected=selected or [],
                returns=returns or [],issues=issues or [],groupId=gid,requestId=str(uuid.uuid4()),expectedRevision=view()["revision"]))
    page=context.new_page();page.set_default_timeout(7000)
    writes=[];reads=[];refreshes=[];errors=[]
    def seen(req):
        if req.url==endpoint and req.method=="GET":reads.append(req)
        if req.url.startswith(endpoint+"/parent?"):refreshes.append(req.url)
        if req.url==endpoint+"/commands":writes.append(req.post_data_json)
    page.on("request",seen);page.on("pageerror",lambda e:errors.append(str(e)));page.goto(base)
    btn=lambda scope,name:scope.get_by_role("button",name=name,exact=True)
    dialog=lambda name:page.get_by_role("dialog",name=name,exact=True)
    def prepare(members=keys):
        snapshot=view()
        result=post(context.request,"SAVE_BASKET",members,members,[dict(lot=snapshot["materials"][0]["lot"],quantity=2)],
                    [dict(lot=snapshot["returnCandidates"][0],quantity=1,length=200)])
        assert result.ok,result.text()
        return result.json()["groupId"]
    board=page.get_by_role("region",name="작업 장바구니")
    master=board.get_by_role("table",name="조회 목록과 작업 선택")
    parents=master.locator("tbody tr")
    popup=dialog("장바구니 자재");confirm=dialog("자재 초기화 확인")
    expected_checks=1 if terminal=="DEMO-A2" else 2
    order=[keys[1],keys[0]] if terminal=="DEMO-A2" else keys
    def enter(count=2):
        btn(page,"생산").tap();page.locator("button[data-view=basket]").first.tap()
        expect(parents).to_have_count(count)
    def lower_edge(gid):
        cells=master.get_by_role("button",name=gid,exact=True)
        expect(cells).to_have_count(expected_checks)
        cell=cells.last.locator("..")
        cell.scroll_into_view_if_needed()
        bounds=cell.bounding_box()
        cell.tap(position={"x":2,"y":int(bounds["height"])-3})
        expect(popup).to_be_visible()
        expect(parents.nth(1)).to_have_attribute("aria-current","true")
    def clear_tab(tab):
        popup.get_by_role("tab",name=tab).tap();btn(popup,"초기화").tap();btn(confirm,"예").tap();expect(popup).to_have_count(0)
        assert writes[-1]["visible"]==[order[1]]
    def restored():
        expect(parents.first).to_have_attribute("aria-current","true")
        expect(parents.first.get_by_role("button",name=date+"/"+str(order[0]["sequence"])+" 선택삭제")).to_have_count(1)
        expect(master.locator("input:checked")).to_have_count(0)
        expect(board.get_by_role("table",name="투입자재 목록").locator("tbody tr")).to_have_count(0)
        expect(board.get_by_role("table",name="반납자재 목록").locator("tbody tr")).to_have_count(0)
        snap=view()
        assert not snap["groups"] and all(w["phase"]=="READY" and w["groupId"] is None for w in snap["work"] if w["plan"]["key"] in keys)
    gid=prepare();enter();lower_edge(gid)
    expect(master.locator("input:checked")).to_have_count(expected_checks)
    count=len(reads);btn(popup,"닫기").tap()
    expect(popup).to_have_count(0);expect(parents.nth(1)).to_have_attribute("aria-current","true")
    expect(master.locator("input:checked")).to_have_count(expected_checks)
    assert len(reads)==count and not writes and not refreshes
    lower_edge(gid);expect(master.locator("input:checked")).to_have_count(0)
    # A second operator clears the other tab; the first operator's stale confirmation must keep this dialog open.
    expect(btn(popup,"초기화")).to_be_enabled()
    assert post(other.request,"CLEAR_BASKET_RETURNS",[keys[0]],gid=gid).ok
    btn(popup,"초기화").tap();btn(confirm,"예").tap()
    expect(popup.get_by_role("alert")).to_contain_text("다른 작업에서 자재가 변경")
    expect(parents.nth(1)).to_have_attribute("aria-current","true")
    expect(master.locator("input:checked")).to_have_count(0)
    if capture:page.screenshot(path=capture/(terminal+"-shared-conflict.png"))
    clear_tab("투입자재");restored();assert len(refreshes)==1
    btn(page,"메뉴 복귀").tap()
    gid=prepare();enter();lower_edge(gid);clear_tab("투입자재")
    assert len(view()["groups"])==1
    assert len(refreshes)==1
    expect(parents.nth(1)).to_have_attribute("aria-current","true")
    lower_edge(gid);expect(master.locator("input:checked")).to_have_count(0)
    clear_tab("반납자재");restored();assert len(refreshes)==2
    # SELECT_GV1 initially contains just the saved group; SELECT2_GV1 must also bring back the
    # other eligible work order the operator never saw on that freshly opened screen.
    btn(page,"메뉴 복귀").tap()
    gid=prepare([order[1]]);enter(1)
    for tab in ("투입자재","반납자재"):
        btn(board,gid).tap();popup.get_by_role("tab",name=tab).tap();btn(popup,"초기화").tap();btn(confirm,"예").tap()
        expect(popup).to_have_count(0)
    expect(parents).to_have_count(2);restored()
    assert len(refreshes)==3 and "order=BASKTEST000"+digits in refreshes[-1]
    def clear_one(gid):
        for tab in ("투입자재","반납자재"):
            btn(board,gid).tap();popup.get_by_role("tab",name=tab).tap();btn(popup,"초기화").tap();btn(confirm,"예").tap()
            expect(popup).to_have_count(0)
    # The native parent's local delete list is applied after the result is bound.
    btn(parents.nth(1),date+"/"+str(order[1]["sequence"])+" 선택삭제").tap()
    expect(parents).to_have_count(1)
    gid=prepare([order[0]])
    parents.first.get_by_role("checkbox").tap()
    clear_one(gid);expect(parents).to_have_count(1)
    expect(parents.first.get_by_role("button",name=date+"/"+str(order[0]["sequence"])+" 선택삭제")).to_have_count(1)
    # A sixteen-character scan retains the four-character customer detail at the final parent query.
    btn(page,"메뉴 복귀").tap();enter(0)
    reader=dialog("ComOrderNoScan").get_by_role("textbox")
    reader.fill("BASKTEST000"+digits+"0001");reader.press("Enter")
    expect(parents).to_have_count(1);gid=prepare([keys[0]])
    parents.first.get_by_role("checkbox").tap();clear_one(gid)
    expect(parents).to_have_count(1)
    assert len(refreshes)==5 and "detail=0001" in refreshes[-1]
    if capture:page.screenshot(path=capture/(terminal+"-shared-released.png"))
    assert not errors,errors
    other.close();context.close()
    print("PASS",terminal,"shared second-row cell, group check/uncheck, close, conflict/retry, both possible last tabs, two READY rows")
