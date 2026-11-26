"""Compare a fresh isolated comparison server with its local read-only capture.

Requires Playwright for Python and Chrome. The captured names, codes and password
stay in-process. This check expects the DEMO-A binding and untouched initial
settings. The server should be started with the warehouse-test gate enabled.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

def grid(table):
    table.wait_for()
    return table.locator("tbody tr").evaluate_all(
        "(rows) => rows.map(row => [...row.cells].map(cell => cell.textContent))"
    )


def login(context, base, terminal):
    response = context.request.post(
        base + "/api/pop/session",
        data={"terminalId": terminal, "method": "scan", "identifier": "0000"},
    )
    assert response.ok


def verify_process_save(page, context, base, source):
    """Exercise a fresh isolated 003 instance. Saving a process clears dependent scratch settings."""
    from playwright.sync_api import expect
    def button(label):
        return page.get_by_role("button", name=label, exact=True)

    session_url = base + "/api/pop/session"
    before = context.request.get(session_url).json()
    assert before["workCenterCode"] == "003" and not before["groupWork"]
    assert before["processSlots"] == [4, 5, 6]
    candidate = next(row["code"] for row in source["processes"] if row["code"] not in before["workCodes"].values())
    button("메뉴 복귀").tap()
    button("생산").tap()
    first = page.locator('.production-menu [data-slot="1"]')
    expect(first).to_be_disabled()
    button("관리").tap()
    button("단말 설정").tap()
    button("공정 설정").tap()
    page.locator('.settings-process-slots [data-slot="1"]').tap()
    page.get_by_role("table", name="공정 목록").get_by_role("button", name=candidate, exact=True).tap()
    page.locator(".settings-slot").get_by_role("button", name="저장", exact=True).tap()
    with page.expect_response(lambda response: response.url.endswith("/section/process")) as save:
        page.get_by_role("dialog", name="System Message").get_by_role("button", name="예").tap()
    assert save.value.status == 200
    expect(page.locator(".settings-slot")).not_to_be_visible()
    button("메뉴 복귀").tap()
    button("생산").tap()
    expect(first).to_be_enabled()
    assert first.get_attribute("data-view") == "basket"
    first.tap()
    expect(page.locator("header h1")).to_have_text("폭 절단")
    updated = context.request.get(session_url).json()
    assert updated["processSlots"] == [1, 4, 5, 6] and updated["workCodes"]["1"] == candidate
    button("로그아웃").tap()
    button("예").tap()
    expect(button("관리")).not_to_be_visible()
    login(context, base, "DEMO-A")
    assert context.request.get(session_url).json()["workCodes"]["1"] == candidate
    page.reload()
    expect(page.locator('.production-menu [data-slot="1"]')).to_be_enabled()


def verify(base, source, secret, exercise_process):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        context = browser.new_context(viewport={"width": 1380, "height": 886}, has_touch=True)
        url = base + "/api/pop/admin/terminal-settings/DEMO-A"
        assert context.request.get(url).status == 401
        login(context, base, "DEMO-A")
        settings = context.request.get(url).json()["view"]
        selected = source["originalSelection"]
        slots = {slot: code for slot, code in selected["slots"].items() if code}
        assert settings["processSelection"]["codes"] == slots
        assert settings["saved"]["values"]["materials"] == selected["materials"]
        assert not settings["catalog"]["warehouses"]

        equipment = context.request.get(url + "/equipment").json()
        for field in ("plant", "center", "plantName", "centerName"):
            assert equipment["site"][field] == source[field]
        assert equipment["machineSettingsPresent"] == source["machineSettingsFilePresent"]
        other_url = base + "/api/pop/admin/terminal-settings/DEMO-B"
        assert context.request.get(other_url).status == 403
        gate = url + "/warehouse/entry"
        assert context.request.post(gate, data={"password": secret + "x"}).status == 403
        warehouse = context.request.post(gate, data={"password": secret}).json()
        assert warehouse["saved"]["roles"] == selected["warehouses"]
        assert warehouse["applied"]["roles"] == selected["warehouses"]

        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(type(error).__name__))
        page.goto(base)

        def button(label):
            return page.get_by_role("button", name=label, exact=True)

        def close_dialog():
            page.get_by_role("dialog").get_by_role("button", name="닫기", exact=True).first.tap()

        button("관리").tap()
        button("단말 설정").tap()
        button("공정 설정").tap()
        expected = [[str(row["idx"]), row["code"], row["name"]] for row in source["processes"]]
        assert grid(page.get_by_role("table", name="공정 목록")) == expected
        for slot in range(1, 7):
            assigned = page.locator(f'.settings-process-slots [data-slot="{slot}"]').get_attribute("data-assigned")
            assert (assigned == "true") == (str(slot) in slots)
        close_dialog()

        button("재질 설정").tap()
        materials = page.locator(".settings-material table")
        expected = [[str(row["idx"]), row["code"], row["name"]] for row in source["materials"]]
        assert [cells[1:] for cells in grid(materials)] == expected
        assert materials.get_by_role("checkbox", checked=True).count() == len(selected["materials"])
        close_dialog()

        button("창고 설정").tap()
        page.locator("#wh-pass").fill(secret)
        page.get_by_role("dialog").get_by_role("button", name="확인", exact=True).tap()
        table = page.get_by_role("table", name="창고 목록")
        expected = [[str(row["idx"]), source.get("warehousePlantName", source["plantName"]), row["code"], row["name"]] for row in source["warehouses"]]
        assert [cells[:4] for cells in grid(table)] == expected
        assert table.get_by_role("checkbox", checked=True).count() == sum(map(len, selected["warehouses"].values()))
        page.get_by_role("dialog").get_by_role("button", name="취소", exact=True).tap()
        if exercise_process:
            verify_process_save(page, context, base, source)
        assert not errors

        other = browser.new_context()
        login(other, base, "DEMO-B")
        fallback = other.request.get(other_url).json()["view"]
        assert fallback["catalog"]["processes"] == ["B-CUT", "B-PACK"]
        browser.close()
        print("Verified settings rows, six slots, material selections, five warehouse roles and terminal isolation.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="Local web preview URL")
    parser.add_argument("--file", type=Path, default=Path(os.environ.get("LOCALAPPDATA", ".")) / "ShinjinPOP/local-reference/terminal-settings.json")
    parser.add_argument("--exercise-process", action="store_true", help="Also save slot 1 on a disposable, freshly started 003 instance")
    args = parser.parse_args()
    if urlparse(args.base).hostname not in {"127.0.0.1", "::1", "localhost"}:
        parser.error("Use a loopback preview")
    secret = os.environ.get("POP_WAREHOUSE_TEST_PASSWORD")
    if not secret:
        parser.error("Set the local warehouse test password in the environment")
    try:
        verify(args.base.rstrip("/"), json.loads(args.file.read_text("utf-8-sig")), secret, args.exercise_process)
    except Exception as error:
        # Browser assertion messages may include grid values.
        print("Local comparison failed (" + type(error).__name__ + ")", file=sys.stderr)
        sys.exit(1)
