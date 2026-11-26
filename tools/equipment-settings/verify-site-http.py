"""Loopback-only synthetic equipment HTTP regression. Run against a fresh demo-centers fixture."""
import json
import sys
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

a, z, b, read = Client(A, "DEMO-W01"), Client(Z, "DEMO-W04"), Client(B, "DEMO-W03"), Client(A, "DEMO-W02")
def base(c):
    return c.call("GET",root+c.terminal)["view"]
def cmd(c, action, **kw):
    return c.put(action,c.get()["version"],**kw)
def section(c, name, **kw):
    if name=="process" and "slots" not in kw:
        selected=c.get()["slotCodes"]
        selected["6" if c.get()["groupCenter"] else "1"]=kw["code"]
        kw["slots"]=selected
    return c.call("PUT",root+c.terminal+"/section/"+name,{"expectedVersion":base(c)["saved"]["version"],**kw})["view"]
def plant(c,p,w,status=200):
    return c.call("PUT",root+c.terminal+"/plant",{"expectedVersion":base(c)["saved"]["version"],
        "equipmentVersion":c.get()["version"],"plant":p,"center":w},status)
def values(c):
    return base(c)["saved"]["values"]
Client().call("PUT",root+A+"/plant",{},401)
a.call("PUT",root+Z+"/plant",{},403)
a.call("PUT",root+Z+"/equipment/pop-id",{"number":"POP01","expectedVersion":0},403)
before = a.get()
read.put("pop-id",before["version"],403,number="POP01")
plant(read,"P1","005",403)
plant(a,"P2","005",422)
cmd(a,"add");cmd(a,"assign",number="001",side="START")
assert a.get()["saved"]["group"]["number"]=="001"
a.call("PUT",root+A+"/printers",{"expectedVersion":base(a)["saved"]["version"],"outputs":{"document":"A-DOC","shipment":"A-SHIP","label":"A-LABEL"}})
cmd(a,"machines",machines=["M0"+str(i) for i in range(1,7)])
assert len(a.get()["saved"]["machines"])==6
assert values(a)["materials"]==[]
section(a,"materials",materials=[base(a)["catalog"]["materials"][0]["code"]])
cmd(a,"pop-id",number="POP01");cmd(a,"pop-id",number="POP02")
assert [r["owner"] for r in a.get()["popRows"]]==["",A]
old = z.get()["version"]
cmd(a,"pop-id",number="POP01")
z.put("pop-id",old,409,number="POP01")
cmd(z,"pop-id",number="POP01")
cmd(z,"machines",machines=["M01"])
assert a.get()["machines"][1]["owner"]==Z and a.get()["saved"]["machines"][0]=="M01"
assert a.get()["saved"]["popId"]==A and a.get()["popRows"][0]["owner"]==Z
prior = a.get()
a.put("pop-id",prior["version"],422,number="M01")
a.put("machines",prior["version"],422,machines=["POP01"])
assert a.get()==prior
print("PASS 6 machines, distinct POP equipment kind, takeover, reject stale or forged codes, terminal local copies survive remote reassignment")

a.login("DEMO-W01"); before=base(a); eqBefore=a.get()
bad={"expectedVersion":before["saved"]["version"],"equipmentVersion":eqBefore["version"]-1,"plant":"P1","center":"105"}
a.call("PUT",root+A+"/plant",bad,409)
bad.update(expectedVersion=bad["expectedVersion"]-1,equipmentVersion=eqBefore["version"])
a.call("PUT",root+A+"/plant",bad,409)
assert base(a)==before and a.get()==eqBefore
plant(a,"P1","105")
v=values(a)
assert v["process"]==v["warehouse"]=="" and v["materials"]==[] and v["outputs"]==before["saved"]["values"]["outputs"]
eq=a.get()
assert eq["saved"]=={"machines":[],"group":None,"popId":""}
assert eq["applied"]==eqBefore["applied"] and base(a)["applied"]==before["applied"]
assert eq["groups"]==eqBefore["groups"] and z.get()["machines"][1]["owner"]==Z
for action in ("machines","assign","pop-id"): a.put(action,eq["version"],422)
assert a.get()==eq
assert b.get()["saved"]["machines"]==[]
assert a.login("DEMO-W01")["groupWork"] and a.call("GET","/api/pop/process-group-demo")["setting"]["center"]=="105"
assert a.get()["applied"]==eq["saved"]
print("PASS exact plant reset, stale settings and equipment revisions, retained printer/registry/other terminal/current session, new center on relogin")

a.call("PUT",root+A+"/section/warehouse",{"expectedVersion":base(a)["saved"]["version"],"code":"A-RETURN"},403)
section(a,"process",code="A-CUT")
cmd(a,"assign",number="001",side="END")
cmd(a,"machines",machines=["M03"]);cmd(a,"pop-id",number="POP02")
section(a,"materials",materials=[base(a)["catalog"]["materials"][0]["code"]])
g=a.get()["saved"]["group"]
section(a,"process",code="A-CUT")
assert a.get()["saved"]=={"machines":[],"group":g,"popId":""}
assert values(a)["warehouse"]=="" and values(a)["materials"]==[]
assert a.get()["popRows"][1]["owner"]==A and a.get()["machines"][3]["owner"]==A
cmd(a,"machines",machines=["000000"])
section(a,"materials",materials=[base(a)["catalog"]["materials"][0]["code"]])
cmd(a,"pop-id",number="POP01")
cmd(a,"machines",machines=["M03"])
assert values(a)["materials"]==[] and a.get()["saved"]["popId"]==A and a.get()["saved"]["group"]==g
plant(a,"P1","105")
assert values(a)["process"]=="" and values(a)["warehouse"]=="" and a.get()["saved"]["group"] is None
plant(a,"P1B","001")
assert a.get()["groups"]==[] and not a.get()["groupCenter"]
assert a.login("DEMO-W01")["groupWork"] is False
a.call("GET","/api/pop/process-group-demo",status=403)
assert b.login("DEMO-W03")["packingMenu"]
b.call("GET","/api/pop/packing")
plant(b,"P2","005")
b.call("GET","/api/pop/packing")
id2=b.login("DEMO-W03")
assert id2["groupWork"] and not id2["packingMenu"]
b.call("GET","/api/pop/packing",status=403)
print("PASS same-value save resets exact dependants, process retains warehouse/group, machine retains POP ID, plant registry isolation, packing/menu access pinned through relogin")

prior=base(b)
b.call("PUT",root+B+"/section/process",{"expectedVersion":prior["saved"]["version"],"code":"B-CUT","slots":{"1":"B-CUT"}},422)
assert base(b)==prior
plant(b,"P2","001")
section(b,"process",code="B-CUT",slots={"1":"B-CUT","6":"B-PACK"})
identity=b.login("DEMO-W03")
assert identity["processSlots"]==[1,6] and identity["workCenterCode"]=="001" and identity["packingMenu"]
section(b,"process",code="B-CUT",slots={"1":"B-CUT"})
identity=b.login("DEMO-W03")
assert identity["processSlots"]==[1] and not identity["packingMenu"] and identity["initialView"]=="orders"
print("PASS server-bound slots, reserved-group-slot rejection, ordinary multiple slots and slot removal reflected in login/menu")
