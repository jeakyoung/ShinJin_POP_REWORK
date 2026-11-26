"""Loopback-only synthetic equipment HTTP regression. Run against a fresh demo-centers fixture."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request

origin = sys.argv[1]
assert urlparse(origin).hostname == "127.0.0.1"
root = "/api/pop/admin/terminal-settings/"
A, Z, B = "DEMO-A", "DEMO-A2", "DEMO-B"

class Client:
    def __init__(self, terminal=A, worker=None):
        self.web = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
        self.terminal = terminal
        self.path = root + terminal + "/equipment"
        if worker:
            self.login(worker)

    def call(self, method, path, body=None, status=200):
        request = Request(origin + path, None if body is None else json.dumps(body).encode(),
                          {"Content-Type": "application/json"}, method=method)
        try:
            response = self.web.open(request, timeout=10)
        except HTTPError as e:
            response = e
        with response:
            data = response.read()
            assert response.status == status, (method, path, response.status, status, data[:500])
            return json.loads(data) if data else None

    def login(self, worker):
        return self.call("POST", "/api/pop/session", {"terminalId": self.terminal, "identifier": worker,
            "method": "manual", "passcode": "demo-only"})

    def get(self):
        return self.call("GET", self.path)

    def put(self, action, version, status=200, **fields):
        return self.call("PUT", self.path + "/" + action, {"expectedVersion": version, **fields}, status)

Client().call("GET", root+A+"/equipment", status=401)
a, other, z, b, reader = (Client(A, "DEMO-W01"), Client(A, "DEMO-W01"), Client(Z, "DEMO-W04"),
                            Client(B, "DEMO-W03"), Client(A, "DEMO-W02"))
assert reader.get()["canEdit"] is False
for action in ("machines","add","remove","assign","processes"):
    reader.put(action, 0, 403)
a.call("GET", root+Z+"/equipment", status=403)
a.call("PUT", root+Z+"/equipment/add", {"expectedVersion":0},403)
assert not b.get()["groupCenter"]
b.put("add",0,403)
b.call("GET","/api/pop/process-group-demo",status=403)
for ids in [[], ["M01"]*2, ["M01", "000000"], ["UNKNOWN"], [f"M0{i}" for i in range(1,8)]]:
    a.put("machines",0,422,machines=ids)
assert a.get()["version"] == 0
def race(client):
    try:
        client.put("machines",0,machines=["M02","M01"])
        return 200
    except AssertionError as ex:
        assert ex.args[0][2] == 409, ex
        return 409
with ThreadPoolExecutor(2) as ex:
    assert sorted(ex.map(race,[a,other])) == [200,409]
v=a.get()
assert v["saved"]["machines"] == ["M01","M02"] and v["applied"]["machines"] == []
assert other.put("machines",0,409,machines=["000000"]) == other.get()
a.call("POST", root+A+"/refresh")
assert a.get()["applied"]["machines"] == []
a.login("DEMO-W01")
assert a.get()["applied"]["machines"] == ["M01","M02"]
assert reader.get()["applied"]["machines"] == []
assert a.put("machines",1,machines=["000000"])["saved"]["machines"] == ["000000"]
assert all(not m["owner"] for m in a.get()["machines"])
print("PASS unauthenticated, worker/foreign-terminal writes, ordinary center, invalid selection, concurrent 200/409, login-only machine snapshot")
v=a.put("add",2)
number=v["groups"][0]["number"]
sg=[{"process":"P02","warehouse":"W01"},{"process":"P01","warehouse":"W02"}]
for steps in [[], [sg[0],sg[0]], [{"process":"P01","warehouse":""}], [{"process":"X","warehouse":"W01"}]]:
    a.put("processes",3,422,number=number,steps=steps)
z.put("processes",3,number=number,steps=sg)
a.put("assign",3,409,number=number,side="END")
a.put("assign",4,422,number=number,side="UNKNOWN")
a.put("assign",4,number=number,side="START")
v=z.put("assign",5,number=number,side="END")
assert (v["groups"][0]["start"],v["groups"][0]["end"]) == (A,Z)
assert a.get()["applied"]["group"] is None
assert a.login("DEMO-W01")["initialView"] == "home"
assert z.login("DEMO-W04")["groupWork"]
work="/api/pop/process-group-demo"
assert [s["process"] for s in a.call("GET",work)["setting"]["stages"]] == ["합성 검사","합성 절단"]
assert a.call("GET",work)["setting"]["center"]=="005" and z.call("GET",work)["setting"]["center"]=="105"
a.call("GET",work+"/test-DEMO-A2",status=403)
a.call("POST",work,{"action":"START","revision":0,"lines":[{"plan":"PLAN-A"}]})
v=a.put("processes",6,number=number,steps=sg[::-1])
a.put("assign",7,number=number,side="END")
a.login("DEMO-W01")
assert a.get()["applied"]["group"]["steps"] == sg[::-1]
result=a.call("POST",work,{"action":"FINISH","revision":1,"lines":[{"plan":"PLAN-A","good":1,"bad":0}]})
assert [e["stage"]["process"] for e in result["results"]] == ["합성 검사","합성 절단"]
assert a.call("GET",work)["setting"]["stages"][0]["process"] == "합성 절단"
v=a.put("remove",8,number=number)
assert not v["groups"] and v["saved"]["group"]["number"]==number
assert b.get()["version"]==0
print("PASS plant isolation, single START/END assignment, subeditor order/warehouse, invalid/stale unchanged, 005/105 relogin and menu contract, active batch stage pin, delete vs local copy")
