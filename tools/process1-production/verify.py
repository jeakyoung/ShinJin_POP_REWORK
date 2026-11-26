"""Run against a new local Spring demo process. Usage: python verify.py <boot.jar>"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.cookiejar import CookieJar
from pathlib import Path
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
DATE = "2026-11-25"
WORK = "/api/pop/work-orders/"
PROD = WORK + "production"


def key():
    return str(uuid.uuid4())


@contextmanager
def app(jar, fixture=None, manual_stock=False):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = "http://127.0.0.1:" + str(port)
    with tempfile.TemporaryDirectory() as temp:
        java = str(Path(os.environ["JAVA_HOME"]) / "bin" / ("java.exe" if os.name == "nt" else "java")) if os.getenv("JAVA_HOME") else "java"
        args = [java, "-jar", str(jar), "--server.address=127.0.0.1", "--server.port=" + str(port),
                "--spring.profiles.active=demo", "--shinjin.demo.dataset=" + str(ROOT / "tools/demo-dataset/process-003.json")]
        if manual_stock:
            args.append("--shinjin.demo.process1-material-stock=" + (ROOT / "tools/demo-dataset/process1-manual-stock.json").as_uri())
        if fixture:
            config = Path(temp) / "production.json"
            config.write_text(json.dumps(fixture), encoding="utf-8")
            args.append("--shinjin.demo.process1-production=" + config.as_uri())
        with (Path(temp) / "boot.log").open("w+b") as log:
            process = subprocess.Popen(args, cwd=temp, stdout=log, stderr=log)
            try:
                for _ in range(160):
                    if process.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(log.read().decode(errors="replace")[-4000:])
                    try:
                        urllib.request.urlopen(url + "/api/pop/context", timeout=1).close()
                        break
                    except OSError:
                        time.sleep(.25)
                yield url
            finally:
                process.terminate()
                process.wait(timeout=20)


class Session:
    def __init__(self, url, terminal="DEMO-A"):
        self.url = url
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        self.request("/api/pop/session", dict(method="scan", identifier="0000", terminalId=terminal))

    def request(self, path, body=None, expected=200):
        req = urllib.request.Request(self.url + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "X-Pop-Work-Code": "001"})
        try:
            response = self.http.open(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read().decode("utf-8")
            assert response.status == expected, (path, expected, response.status, raw)
            return json.loads(raw) if raw else None

    def row(self, sequence):
        r = next(r for r in self.request(PROD) if r["sequence"] == sequence)
        return {k: r[k] for k in ("date", "sequence", "revision")}

    def batch(self, action, selected, **extra):
        rows = [self.row(s) for s in selected]
        return dict(requestId=key(), action=action, selected=rows, visible=rows, **extra)


def route(seq, suffix):
    return WORK + DATE + "/" + str(seq) + "/" + suffix


def material_patch(row):
    return dict(date=row["date"], sequence=row["sequence"], revision=row["revision"],
                event=row["event"]["revision"], quantity=row["event"]["quantity"], spec=row["event"]["spec"])


def run(url):
    user = Session(url)
    plan, started = 101, 102
    grid = route(plan, "production-materials")
    defects = route(plan, "rejections")
    scan = route(plan, "material-scan")
    row = user.request(scan, {"raw": "LOT-A-01"})[0]
    pick = dict(date=DATE, sequence=plan, lot=row["lot"], material=row["material"],
                warehouse=row["warehouse"], location=row["location"], quantity=2)
    def start(picks):
        return user.batch("START", [plan], focus=dict(date=DATE, sequence=plan), scannedIssues=picks)

    assert not user.request(grid)
    user.request(defects, expected=409)
    user.request(PROD, start([pick, {**pick, "location": "NO-LOC"}]), 409)
    assert not user.request(grid) and user.row(plan)["revision"] == 0
    assert user.request(scan, {"raw": pick["lot"]})[0]["available"] == row["available"]
    user.request(PROD, start([{**pick, "material": "NO-ITEM"}]), 409)
    cmd = start([pick])
    assert user.request(PROD, cmd) == user.request(PROD, cmd)
    inputs = user.request(grid)
    assert len(inputs) == 1 and inputs[0]["event"]["quantity"] == 2
    assert inputs[0]["available"] == row["available"] - 2
    assert inputs[0]["event"]["spec"]["length"] == row["length"]
    user.request(PROD, {**cmd, "scannedIssues": [{**pick, "quantity": 1}]}, 409)

    paused = user.batch("PAUSE", [started])
    paused["visible"] = [user.row(plan), user.row(started)]
    user.request(PROD, paused)
    assert user.request(WORK + DATE + "/101")["plan"]["status"] == "PAUSED"
    assert user.request(WORK + DATE + "/102")["plan"]["status"] == "IN_PROGRESS"
    user.request(PROD, paused)
    user.request(route(plan, "actions"), dict(action="RETURN_MATERIAL", expectedRevision=user.row(plan)["revision"],
                                              lotCode=pick["lot"], quantity=1))
    lines = user.request(grid)
    returned = material_patch(next(r for r in lines if r["event"]["action"] == "RETURN_MATERIAL"))
    returned["spec"] = {**returned["spec"], "width": 70}
    change = dict(requestId=key(), action="RETURN_MATERIAL", remove=False, lines=[returned], visible=[user.row(plan)])
    saved = user.request(grid, change)
    assert saved == user.request(grid, change)
    assert next(r for r in saved if r["event"]["action"] == "RETURN_MATERIAL")["event"]["spec"]["width"] == 70
    issue = material_patch(next(r for r in saved if r["event"]["action"] == "ISSUE_MATERIAL"))
    user.request(grid, dict(requestId=key(), action="ISSUE_MATERIAL", remove=True, lines=[issue], visible=[user.row(plan)]), 409)
    previous = user.request(defects)
    wh = previous["warehouses"][0]
    defect = dict(requestId=key(), revision=previous["revision"], warehouse=wh, location=previous["locations"][wh][0],
                  lines=[dict(code=previous["reasons"][0]["code"], quantity=1)])
    user.request(defects, {**defect, "location": "NO-LOC"}, 422)
    other = Session(url)
    def race(session, command):
        try:
            return session.request(defects, command)["saved"]["total"]
        except AssertionError as error:
            assert error.args[0][2] == 409, error
            return "conflict"
    with ThreadPoolExecutor(max_workers=2) as executor:
        jobs = [executor.submit(race, session, {**defect, "requestId": key()}) for session in (user, other)]
        assert sorted(str(job.result()) for job in jobs) == ["1", "conflict"]
    saved = user.request(defects)["saved"]
    assert saved["lines"][0]["updatedBy"] == "DEMO-W01"
    user.request(PROD, user.batch("RESUME", [plan]))
    cmd = user.batch("COMPLETE", [plan])
    cmd["visible"][0]["good"] = 0
    user.request(PROD, cmd)
    assert user.request(PROD, cmd)["applied"]
    state = next(r for r in user.request(PROD) if r["sequence"] == plan)
    assert state["produced"] == 0 and state["bad"] == 1
    user.request(defects, expected=409)
    outsider = Session(url, "DEMO-B")
    outsider.request(grid, expected=404)
    print("PASS scan identity, START atomicity/replay, group STOP, paused return edit, defect race, defect-only END and terminal isolation")


def mixed_group(url):
    user = Session(url)
    for sequence in (101, 102):
        user.request(route(sequence, "actions"), dict(action="ISSUE_MATERIAL", expectedRevision=user.row(sequence)["revision"],
                     lotCode="LOT-A-01", quantity=1, warehouse="WH-A", location="BIN-01"))
    before = user.request(PROD)
    old_group = next(row for row in before if row["sequence"] == 102)
    waiting = dict(date=DATE, sequence=101)
    running = dict(date=DATE, sequence=102)
    cmd = user.batch("START", [101, 102], focus=waiting)
    assert user.request(PROD, cmd, 409)["code"] == "FOCUS_STARTED_ORDER"
    line = user.request(route(101, "production-materials"))[0]
    draft = dict(**waiting, action="ISSUE_MATERIAL", lines=[{**material_patch(line), "quantity": 3}])
    user.request(PROD, {**cmd, "requestId": key(), "focus": running, "materialDrafts": [draft]}, 422)
    assert before == user.request(PROD)
    cmd = user.batch("START", [101, 102], focus=running)
    user.request(PROD, cmd)
    group = user.request(PROD)
    assert group[0]["group"] == old_group["group"] and group[0]["started"] == old_group["started"]
    assert next(row for row in group if row["sequence"] == 102) == old_group
    assert all(r["event"]["quantity"] == 1 for r in user.request(route(101, "production-materials")))
    print("PASS mixed START requires last-focused running order, preserves its time and revision, discards waiting-only material draft")


def manual(url):
    user = Session(url)
    plan = 101
    root = route(plan, "stock-picker")
    grid = route(plan, "production-materials")
    def lookup():
        return user.request(root + "/stock?slot=1", dict(role="issue", warehouse="WH-A", thickness=2.5, width=80))[0]
    def selection(row):
        return dict(date=DATE, sequence=plan, slot=1, source="manual", quantity=1,
                    **{k: row[k] for k in ("warehouse", "location", "lot", "material")})
    issue = selection(lookup())
    cmd = user.batch("START", [plan], focus=dict(date=DATE, sequence=plan), scannedIssues=[issue])
    stranger = Session(url)
    stranger.request(PROD, cmd, 409)
    user.request(PROD, cmd)
    assert user.request(PROD, cmd)["applied"]
    assert len(user.request(grid)) == 1
    user.request(PROD, user.batch("PAUSE", [plan]))
    fragments = user.request(root + "/remnants?slot=1", {})
    issue = selection(fragments["rows"][0])
    cmd = dict(requestId=key(), revision=user.row(plan)["revision"], line=issue)
    stranger.request(grid + "/manual", cmd, 409)
    user.request(grid + "/manual", cmd)
    user.request(grid + "/manual", cmd)
    saved = user.request(grid)
    assert len(saved) == 2
    row = next(r for r in saved if r["event"]["lotCode"] == issue["lot"])
    assert row["event"]["quantity"] == 1 and row["available"] == fragments["rows"][0]["available"] - 1
    print("PASS manual selection first START and paused remnant commit with explicit stock, unobserved session rejection, replay and exact location")


if __name__ == "__main__":
    jar = Path(sys.argv[1]).resolve(strict=True)
    with app(jar) as base:
        run(base)
    with app(jar) as base:
        mixed_group(base)
    with app(jar, manual_stock=True) as base:
        manual(base)
    fixture = json.loads((ROOT / "src/api/src/main/resources/demo/process1-production.json").read_text(encoding="utf-8"))
    fixture["terminals"]["DEMO-A"]["bad"] = []
    with app(jar, fixture) as base:
        user = Session(base)
        assert user.request(route(102, "rejections"), expected=409)["code"] == "BAD_WAREHOUSE_REQUIRED"
    print("PASS assigned bad warehouse missing")
