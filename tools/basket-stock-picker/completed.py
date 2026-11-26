"""Verify the final frmProcess3 ledger with two independently authenticated workers."""
import uuid

from playwright.sync_api import expect


def verify_completed(browser, base, terminal, date, digits, size, capture):
    url = base + "/api/pop/work-baskets"
    headers = {"X-Pop-Process-Slot": "1", "X-Pop-Work-Code": "001"}
    key = dict(date=date, sequence=1)

    def login(identifier):
        ctx = browser.new_context(has_touch=True, viewport=dict(width=size[0], height=size[1]))
        response = ctx.request.post(base + "/api/pop/session", data=dict(
            method="scan", identifier=identifier, terminalId=terminal))
        assert response.ok, response.text()
        return ctx

    first, second = login("0000"), login("SCAN:QA-SECOND")

    def view(ctx=first):
        return ctx.request.get(url, headers=headers).json()

    def body(action, **fields):
        return dict(dict(action=action, requestId=str(uuid.uuid4()), expectedRevision=view()["revision"],
                         visible=[key], selected=[], issues=[], returns=[]), **fields)

    def post(ctx, command):
        return ctx.request.post(url + "/commands", headers=headers, data=command)

    start = view()
    assert start["actor"]["worker"] != view(second)["actor"]["worker"]
    issue = dict(lot=start["materials"][0]["lot"], quantity=1)
    ret = dict(lot=start["returnCandidates"][0], length=200, quantity=1)
    assert post(first, body("SAVE_BASKET", selected=[key], issues=[issue], returns=[ret])).ok
    assert post(first, body("START_BASKET")).ok
    group = view()["groups"][0]["id"]
    assert post(first, body("SET_RETURN_QUANTITY", groupId=group, returnEdit=dict(sequence=1, quantity=4))).ok
    started = view()

    def button(scope, name):
        return scope.get_by_role("button", name=name, exact=True)

    def enter(ctx):
        page = ctx.new_page()
        page.set_default_timeout(6000)
        page.goto(base)
        button(page, "생산").tap()
        page.locator("button[data-view=basket]").first.tap()
        page.get_by_role("checkbox", name=date + "/1 선택", exact=True).check()
        expect(button(page, "반납수량 1행")).to_have_text("4")
        return page

    lead, peer = enter(first), enter(second)
    button(peer, "반납수량 1행").tap()
    pad = peer.get_by_role("dialog", name="반납수량 입력", exact=True)
    button(pad, "9").tap()
    button(lead, "작업 완료").tap()
    button(lead.get_by_role("dialog", name="확인", exact=True), "아니오").tap()
    assert view()["revision"] == started["revision"]
    button(lead, "작업 완료").tap()
    with lead.expect_response(lambda r: r.url == url + "/commands") as sent:
        button(lead.get_by_role("dialog", name="확인", exact=True), "예").tap()
    finish = sent.value.request.post_data_json
    notice = lead.get_by_role("dialog", name="작업 안내", exact=True)
    expect(notice).to_contain_text("작업완료 되었습니다.")
    button(notice, "확인").tap()
    scanner = lead.get_by_role("dialog", name="ComOrderNoScan", exact=True)
    expect(scanner).to_be_visible()
    master = lead.get_by_role("table", name="조회 목록과 작업 선택")
    expect(master.locator("tbody tr")).to_have_count(0)
    expect(lead.get_by_role("table", name="투입자재 목록").locator("tbody tr")).to_have_count(0)
    expect(lead.get_by_role("table", name="반납자재 목록").locator("tbody tr")).to_have_count(0)
    if capture:
        lead.screenshot(path=capture / (terminal + "-next-order.png"))

    final = view()
    assert final["revision"] == started["revision"] + 1
    assert final["groups"] == started["groups"]
    assert next(w for w in final["work"] if w["plan"]["key"] == key)["phase"] == "COMPLETED"
    with peer.expect_response(lambda r: r.url == url + "/commands") as stale:
        button(pad, "적용").tap()
    assert stale.value.status == 409 and stale.value.json()["code"] == "STALE_REVISION"
    warning = peer.get_by_role("dialog", name="작업 안내", exact=True)
    expect(warning).to_contain_text("다른 작업에서 자재가 변경되었습니다.")
    button(warning, "확인").tap()
    for label in ("투입자재 추가", "투입자재 삭제", "반납자재 추가", "반납자재 삭제", "반납길이 1행", "반납수량 1행"):
        expect(button(peer, label)).to_be_disabled()
    expect(button(peer, "반납수량 1행")).to_have_text("4")
    if capture:
        peer.screenshot(path=capture / (terminal + "-completed-materials.png"))
    button(peer, "일괄삭제").tap()
    expect(warning).to_contain_text("작업완료된 건이 존재합니다.")
    button(warning, "확인").tap()

    for action, fields in [
        ("FINISH_BASKET", dict(amounts=[dict(key=key, quantity=1)])),
        ("DELETE_UNFINISHED", {}), ("DELETE_ROW", dict(selected=[key])),
        ("REMOVE_ISSUE_ROWS", dict(groupId=group, removal=dict(rows=[1], checked=[0]))),
        ("REMOVE_RETURN_ROWS", dict(groupId=group, removal=dict(rows=[1], checked=[0]))),
        ("SET_RETURN_QUANTITY", dict(groupId=group, returnEdit=dict(sequence=1, quantity=9))),
        ("SAVE_RETURN_GRID", dict(groupId=group, returns=[ret])),
        ("ADD_MANUAL_ISSUE", dict(groupId=group, manualSequence=0, issues=[issue])),
        ("CLEAR_BASKET_ISSUES", dict(groupId=group)), ("CLEAR_BASKET_RETURNS", dict(groupId=group))
    ]:
        result = post(second, body(action, **fields))
        assert result.status == 409, (action, result.status, result.text())
    assert post(first, finish).json() == sent.value.json()
    assert post(second, finish).status == 403
    assert view() == final
    field = scanner.get_by_role("textbox")
    field.fill("BASKTEST000" + digits + "0001")
    field.press("Enter")
    expect(notice).to_contain_text("해당 공정에서 완료 된 수주건 입니다.")
    assert view() == final
    first.close()
    second.close()
    print("PASS", terminal, "completion confirmation, next scan, concurrent stale edit, final material quantities, 10 blocked commands and replay")
