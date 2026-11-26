"""Verify the 008 material scanner using local demo drafts, without starting work."""
import argparse
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright


def verify(page, base):
    def button(name, parent=None):
        return (parent or page).get_by_role("button", name=name, exact=True)

    page.goto(base)
    page.locator(".login-scan").tap()
    employee = page.locator("#scan-employee")
    employee.fill("0000")
    employee.press("Enter")
    expect(page.locator(".authenticated-bar")).to_be_visible()
    if not page.locator(".workplace-menu").is_visible():
        button("메뉴 복귀").tap()
    button("도면가공").tap()
    panel = button("투입자재 스캔")
    panel.tap()
    expect(page.locator(".drawing-feedback")).to_have_text("작업 리스트를 스캔하여 주십시오.")
    page.locator(".drawing-order-scan").tap()
    order = page.get_by_role("textbox", name="작업지시 번호")
    order.fill("202611251")
    order.press("Enter")
    confirmation = page.locator(".drawing-skip[open]")
    rows = page.get_by_role("table", name="작업지시").locator("tbody tr")
    rows.first.or_(confirmation).first.wait_for()
    if confirmation.is_visible():
        button("예", confirmation).tap()
    expect(rows.first).to_be_visible()
    page.locator(".drawing-scan-dialog > button").tap()
    draft = page.get_by_role("table", name="투입자재").locator("tbody tr").filter(has_text="REM-A")
    expect(draft).to_have_count(1)
    key = "/api/drawing-008/plans/F1/000001/20261125/1"
    initial = page.request.get(base + key).json()["version"]
    panel.tap()
    scan = page.locator('dialog[open][data-mode="material"]')
    field = scan.get_by_role("textbox")
    field.fill("UNKNOWN-DEMO")
    field.press("Enter")
    notice = page.get_by_role("dialog").filter(has_text="유효한 Lot")
    expect(notice).to_be_visible()
    button("확인", notice).tap()
    expect(field).to_be_focused()
    expect(field).to_have_value("")
    field.fill("REM-A")
    field.press("Enter")
    expect(field).to_have_value("")
    button("닫기", scan).tap()
    quantity = draft.locator("td").nth(6)
    if quantity.locator("input").count():
        expect(quantity.locator("input")).to_have_value("2")
    else:
        expect(quantity).to_have_text("2")
    button("투입자재 추가").tap()
    picker = page.get_by_role("dialog", name="투입자재 선택")
    expect(picker).to_be_visible()
    button("닫기", picker).tap()
    assert page.request.get(base + key).json()["version"] == initial
    print("PASS 008 no-order guard, invalid LOT and focus, REM-A 1 -> 2, independent manual +, unchanged plan revision")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    url = parser.parse_args().url.rstrip("/")
    if urlparse(url).hostname not in ("127.0.0.1", "localhost"):
        parser.error("use a local Spring demo")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        verify(browser.new_page(has_touch=True, viewport={"width": 1280, "height": 800}), url)
        browser.close()
