"""Loopback settings contract. Never print the credential, a request body, or a grant."""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request

origin, mode = sys.argv[1:]
assert urlparse(origin).hostname == "127.0.0.1"
secret = os.environ.get("POP_WAREHOUSE_TEST_PASSWORD")
roles = ["issue", "returns", "good", "bad", "auxiliary"]
empty = {r: [] for r in roles}

class Client:
    def __init__(self, terminal="DEMO-A", worker="DEMO-W01"):
        self.http = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
        self.root = "/api/pop/admin/terminal-settings/" + terminal
        self.terminal, self.worker = terminal, worker

    def call(self, method, path, body=None, want=200):
        request = Request(origin + path, None if body is None else json.dumps(body).encode(),
                          {"Content-Type": "application/json"}, method=method)
        try:
            response = self.http.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            assert not secret or secret.encode() not in raw
            if want is None:
                return response.status
            assert response.status == want, (method, path, response.status, want)
            return json.loads(raw) if raw else None

    def login(self):
        self.call("POST", "/api/pop/session", {"terminalId": self.terminal, "identifier": self.worker,
                  "method": "manual", "passcode": "demo-only"})

    def entry(self, password=secret, status=200):
        return self.call("POST", self.root + "/warehouse/entry", {"password": password}, status)

    def close(self, view):
        self.call("POST", self.root + "/warehouse/close", {"entry": view["entry"]}, 204)

    def save(self, view, rules, status=200, step=None):
        return self.call("PUT", self.root + "/warehouse/" + (step or view["step"]),
                         {"entry":view["entry"], "expectedVersion":view["version"], "roles":rules}, status)

a = Client()
a.entry(status=401)
a.login()
if mode != "warehouse":
    a.entry(status=503)
    print("PASS unavailable settings authentication leaves the entry closed")
    sys.exit()

a.entry(password=(secret + "!"), status=403)
x = a.entry()
assert [r["code"] for r in x["rows"]] == ["WH-X", "WH-Y", "WH-Z"]
assert x["saved"]["roles"] == x["applied"]["roles"] == empty
a.close(x)
a.save(x, empty, 403)
x = a.entry()
a.save(x, empty, 409, "priority")
for invalid in [{}, {**empty, "bad":["WH-Q"]}, {**empty, "returns":["WH-X","WH-X"]}, {**empty,"issue":None}]:
    a.save(x, invalid, 422)
z = Client("DEMO-A2","DEMO-W04")
z.login()
z.save(x, empty, 403)
a.call("POST", z.root + "/warehouse/entry", {"password":secret},403)
worker = Client(worker="DEMO-W02")
worker.login()
read = worker.entry()
assert read["canEdit"] is False
worker.save(read, empty, 403)
b = Client("DEMO-B","DEMO-W03")
b.login()
assert [r["code"] for r in b.entry()["rows"]] == ["WH-X", "WH-Q"]
rules = {"issue":["WH-Z","WH-X"],"returns":["WH-Y","WH-X"],"good":["WH-Z","WH-Y","WH-X"],
         "bad":["WH-Z","WH-Y"],"auxiliary":[]}
catalog_order = {k:sorted(v) for k,v in rules.items()}
priority = a.save(x, rules)
assert priority["saved"]["roles"] == catalog_order and priority["applied"]["roles"] == empty
a.close(priority)
a.save(priority, rules, 403)
x = a.entry()
assert x["saved"]["roles"] == catalog_order and z.entry()["saved"]["roles"] == empty
a.close(x)
a.call("POST",a.root+"/refresh")
x = a.entry()
assert x["applied"]["roles"] == empty
peer = Client()
peer.login()
y = peer.entry()
with ThreadPoolExecutor(max_workers=2) as pool:
    runs = [pool.submit(client.save, view, rules, None) for client,view in [(a,x),(peer,y)]]
    assert sorted(task.result() for task in runs) == [200,409]
x = a.entry()
priority = a.save(x, rules)
a.save(priority, {**rules, "bad":["WH-X"]}, 422)
final = a.save(priority,rules)
assert final["saved"]["roles"] == rules
a.save(priority,rules,403)
x = a.entry()
assert x["saved"]["roles"] == rules and x["applied"]["roles"] == empty
base = a.call("GET",a.root)["view"]
a.call("PUT",a.root+"/section/warehouse",{"expectedVersion":base["saved"]["version"],"code":"A-RETURN"},403)
a.call("PUT",a.root,{"expectedVersion":base["saved"]["version"],"values":{**base["saved"]["values"],"warehouse":"A-RETURN"}},403)
a.call("POST","/api/pop/session/logout",{},204)
a.save(x,rules,401)
a.login()
a.save(x,rules,403)
x = a.entry()
assert x["applied"]["roles"] == x["saved"]["roles"] == rules
# An unchanged process save must retain all five saved lists.
base = a.call("GET",a.root)["view"]
slots = dict(base["processSelection"]["codes"])
slots["6"] = "A-CUT"
a.call("PUT",a.root+"/section/process",{"expectedVersion":x["version"],"code":"A-CUT","slots":slots})
assert a.entry()["saved"]["roles"] == rules
# A plant save resets all five lists, and old sessions retain the applied copy.
base = a.call("GET",a.root)["view"]
eq = a.call("GET",a.root+"/equipment")
x = a.entry()
a.call("PUT",a.root+"/plant",{"expectedVersion":base["saved"]["version"],"equipmentVersion":eq["version"],"plant":"P1","center":"105"})
a.save(x,rules,403)
x = a.entry()
assert [r["code"] for r in x["rows"]] == ["WH-R"] and x["saved"]["roles"] == empty and x["applied"]["roles"] == rules
a.login()
assert a.entry()["applied"]["roles"] == empty
last = a.entry()
assert a.save(a.save(last, empty),empty)["saved"]["roles"] == empty
assert a.call("GET",a.root)["view"]["warehouseConfigured"] is False
print("PASS challenge, close, read-only/foreign scope, isolated terminal catalogs and copies, stale/concurrent save, two commits, all five orders, refresh/relogin and plant reset")
