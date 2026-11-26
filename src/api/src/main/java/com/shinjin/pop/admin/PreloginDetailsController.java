package com.shinjin.pop.admin;

import com.shinjin.pop.history.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.*;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import static com.shinjin.pop.admin.LocalSettingsReference.Choice;
import static com.shinjin.pop.admin.PreloginDetailStore.*;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/prelogin-details/{terminalId}")
public final class PreloginDetailsController {
    private static final String GRANT = PreloginDetailsController.class.getName()+".warehouse";
    private final PreloginDetailStore store;
    private final PreloginSettings flags;
    private final PreloginSiteScope sites;
    private final WorkHistoryFixtures fixtures;
    private final LocalSettingsReference master;
    private final Optional<WarehouseSettingsTestAdapter> passwords;
    private record Area(Key key,String factory,String plantName,boolean group,List<String> missing) {}
    private record Grant(Key key,String id,String step,long version) {}
    public record Change(String plant,String center,Long expectedVersion,Map<Integer,String> slots,List<String> materials) {}
    public record ViewRow(int idx,String code,String name) {}
    public record View(String plant,String center,long version,boolean groupCenter,List<ViewRow> rows,Map<Integer,String> slots,List<String> materials) {}
    public record WarehouseView(String entry,String step,long version,String plant,boolean canEdit,List<ViewRow> rows,WarehouseSettings.Rules saved) {}
    public PreloginDetailsController(PreloginDetailStore store,PreloginSettings flags,WorkHistoryFixtures fixtures,
                                     LocalSettingsReference master,PreloginSiteScope sites,Optional<WarehouseSettingsTestAdapter> passwords) {
        this.sites=sites;
        this.store=store;this.flags=flags;this.fixtures=fixtures;this.master=master;this.passwords=passwords;
    }
    private static ResponseStatusException fail(HttpStatus status,String code){return new ResponseStatusException(status,code);}
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String,String>> error(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("code",Objects.toString(error.getReason(),"REQUEST_FAILED")));
    }
    private Area area(String id,HttpServletRequest req,HttpServletResponse res,boolean create) {
        var status=flags.effective(id,req);
        var site=sites.site(id,req);
        if(status.missing().contains("plant")) throw fail(HttpStatus.CONFLICT,"PLANT_REQUIRED");
        var key=new Key(store.browser(req,res,create),id,site.plant(),site.center());
        return new Area(key,site.factory(),site.plantName(),Set.of("005","105").contains(site.center()),status.missing());
    }
    private static String prefix(String id) {
        return switch(id){case "DEMO-A"->"A";case "DEMO-A2"->"A2";case "DEMO-B"->"B";default->throw fail(HttpStatus.NOT_FOUND,"TERMINAL_SCOPE");};
    }
    private List<Choice> rows(Area a,String kind) {
        var k=a.key();
        return switch(kind){
            case "process" -> master.processesFor(k.terminal(),k.plant(),k.center()).orElseGet(()->{
                String p=prefix(k.terminal());return List.of(new Choice(p+"-CUT","합성 절단"),new Choice(p+"-PACK","합성 포장"));
            });
            case "material" -> master.materialsFor(k.terminal(),k.plant(),k.center()).orElseGet(()->
                MaterialSettingsFixture.forTerminal(prefix(k.terminal())).stream().map(r->new Choice(r.code(),r.name())).toList());
            case "warehouse" -> master.warehousesFor(k.terminal(),k.plant(),k.center()).orElseGet(()->passwords.map(adapter->
                adapter.rows(new WarehouseSettings.Area(a.factory(),k.plant(),k.center())).stream().map(r->new Choice(r.code(),r.name())).toList()).orElse(List.of()));
            default -> throw fail(HttpStatus.NOT_FOUND,"UNKNOWN_SECTION");
        };
    }
    private List<ViewRow> display(Area area,String kind,List<Choice> choices) {
        var indices=new HashMap<String,Integer>();
        reference(area).ifPresent(s->{
            switch(kind) {
                case "process" -> s.processes().forEach(r->indices.put(r.code(),r.idx()));
                case "material" -> s.materials().forEach(r->indices.put(r.code(),r.idx()));
                case "warehouse" -> s.warehouses().forEach(r->indices.put(r.code(),r.idx()));
                default -> throw new IllegalArgumentException(kind);
            }
        });
        var rows=new ArrayList<ViewRow>();
        for (Choice choice:choices) rows.add(new ViewRow(indices.getOrDefault(choice.code(),rows.size()+1),choice.code(),choice.name()));
        return List.copyOf(rows);
    }
    private Optional<LocalSettingsReference.Snapshot> reference(Area a) {
        var k=a.key();return master.forSite(k.terminal(),k.plant(),k.center());
    }
    private Map<Integer,String> slots(Area a,LocalPin local) {
        if(local.slots()!=null)return local.slots();
        if(a.missing().contains("process"))return Map.of();
        return reference(a).map(LocalSettingsReference.Snapshot::selectedSlots).orElseGet(()->{
            var codes=fixtures.menuProcesses(a.key().terminal());
            var defaults=new TreeMap<Integer,String>();
            codes.slots().forEach((slot,work)->codes.settings().entrySet().stream().filter(e->work.equals(e.getValue()))
                .findFirst().ifPresent(e->defaults.put(slot,e.getKey())));
            return Map.copyOf(defaults);
        });
    }
    private void prerequisites(Area a,Entry entry,String kind) {
        if(!kind.equals("material"))return;
        var state=entry.pin();
        if(state.slots()==null && a.missing().contains("process"))throw fail(HttpStatus.CONFLICT,"PROCESS_REQUIRED");
        if(Boolean.TRUE.equals(entry.machineReady()))return;
        if(state.slots()!=null || a.missing().contains("machine") || reference(a).map(s->!s.machineSettingsFilePresent()).orElse(false))throw fail(HttpStatus.CONFLICT,"MACHINE_REQUIRED");
    }
    private List<String> selectedMaterials(Area a,LocalPin pin,List<Choice> rows) {
        if(pin.materials()!=null)return pin.materials();
        if(a.missing().contains("material"))return List.of();
        return reference(a).map(s->s.originalSelection().materials()).orElseGet(()->rows.stream().limit(1).map(Choice::code).toList());
    }
    private static <T> ResponseEntity<T> ok(T body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);}
    @GetMapping("/{kind:process|material|warehouse}")
    ResponseEntity<View> read(@PathVariable String terminalId,@PathVariable String kind,HttpServletRequest req,HttpServletResponse res) {
        var a=area(terminalId,req,res,true);var state=store.current(a.key());
        prerequisites(a,state,kind);
        var data=kind.equals("warehouse")?List.<Choice>of():rows(a,kind);
        return ok(new View(a.key().plant(),a.key().center(),state.version(),a.group(),display(a,kind,data),kind.equals("process")?slots(a,state.pin()):Map.of(),
            kind.equals("material")?selectedMaterials(a,state.pin(),data):List.of()));
    }
    @PutMapping(value="/{kind:process|material}",consumes="application/json")
    ResponseEntity<Void> change(@PathVariable String terminalId,@PathVariable String kind,@RequestBody Change c,HttpServletRequest req,HttpServletResponse res){
        var a=area(terminalId,req,res,false);
        if (!a.key().plant().equals(c.plant()) || !a.key().center().equals(c.center()))
            throw fail(HttpStatus.CONFLICT,"STALE_SETTINGS");
        var codes=rows(a,kind).stream().map(Choice::code).toList();
        store.save(a.key(),c.expectedVersion(),kind.equals("process") ? Boolean.FALSE : null,entry->{
            var old=entry.pin();
            prerequisites(a,entry,kind);
            if(kind.equals("process")){
                var previous=slots(a,old);
                if(a.group() && c.slots()!=null) for(int slot=1;slot<=5;slot++) {
                    if(!Objects.equals(previous.get(slot),c.slots().get(slot))) throw fail(HttpStatus.UNPROCESSABLE_ENTITY,"RESERVED_SLOT");
                }
                if(c.slots()==null || c.slots().isEmpty() || c.slots().entrySet().stream().anyMatch(e->e.getKey()==null || e.getKey()<1 ||
                    e.getKey()>6 || e.getValue()==null || !codes.contains(e.getValue()))) throw fail(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_PROCESS");
                return new LocalPin(c.slots(),List.of(),old.warehouses());
            }
            var list=c.materials();
            if(list==null || list.isEmpty() || !new HashSet<>(codes).containsAll(list) || new HashSet<>(list).size()!=list.size())
                throw fail(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_MATERIAL");
            return new LocalPin(old.slots(),codes.stream().filter(list::contains).toList(),old.warehouses());
        });
        return ResponseEntity.noContent().build();
    }
    private String warehousePlant(Area a) {
        return reference(a).map(LocalSettingsReference.Snapshot::warehousePlantName).orElse(a.plantName());
    }
    private Map<String,List<String>> memberships(Area a,LocalPin state) {
        if(state.warehouses()!=null)return state.warehouses().isEmpty()?WarehouseSettings.Rules.empty().roles():state.warehouses();
        if(a.missing().contains("warehouse"))return WarehouseSettings.Rules.empty().roles();
        return reference(a).map(s->s.originalSelection().warehouses()).orElse(WarehouseSettings.Rules.empty().roles());
    }
    @PostMapping(value="/warehouse/entry",consumes="application/json")
    synchronized ResponseEntity<WarehouseView> enter(@PathVariable String terminalId,@RequestBody WarehouseSettings.Challenge challenge,HttpServletRequest req,HttpServletResponse res){
        var a=area(terminalId,req,res,false);
        var session=req.getSession(true);session.removeAttribute(GRANT);
        passwords.orElseThrow(()->fail(HttpStatus.SERVICE_UNAVAILABLE,"AUTH_UNAVAILABLE")).verify(challenge.password());
        var state=store.current(a.key());var candidates=rows(a,"warehouse");
        var grant=new Grant(a.key(),UUID.randomUUID().toString(),"selection",state.version());
        session.setAttribute(GRANT,grant);
        return ok(new WarehouseView(grant.id(),grant.step(),grant.version(),warehousePlant(a),true,display(a,"warehouse",candidates),new WarehouseSettings.Rules(memberships(a,state.pin()))));
    }
    @PostMapping(value="/warehouse/close",consumes="application/json")
    synchronized ResponseEntity<Void> close(@PathVariable String terminalId,@RequestBody WarehouseSettings.Command c,HttpServletRequest req,HttpServletResponse res){
        var a=area(terminalId,req,res,false);var session=req.getSession(false);
        if(session!=null && session.getAttribute(GRANT) instanceof Grant g && g.key().equals(a.key()) && g.id().equals(c.entry())) session.removeAttribute(GRANT);
        return ResponseEntity.noContent().build();
    }
    @PutMapping(value="/warehouse/{step:selection|priority}",consumes="application/json")
    synchronized ResponseEntity<WarehouseView> writeWarehouse(@PathVariable String terminalId,@PathVariable String step,@RequestBody WarehouseSettings.Command c,HttpServletRequest req,HttpServletResponse res){
        var a=area(terminalId,req,res,false);var session=req.getSession(false);
        if(session==null || !(session.getAttribute(GRANT) instanceof Grant g) || !g.key().equals(a.key()) || !g.id().equals(c.entry()))
            throw fail(HttpStatus.FORBIDDEN,"SETTINGS_AUTH_REQUIRED");
        if(!step.equals(g.step()) || !Objects.equals(c.expectedVersion(),g.version()))throw fail(HttpStatus.CONFLICT,"STALE_SETTINGS");
        var candidates=rows(a,"warehouse");var codes=candidates.stream().map(Choice::code).toList();
        boolean select=step.equals("selection");
        var state=store.save(a.key(),g.version(),null,entry->{
            var old=entry.pin();
            var desired=c.roles();
            if(desired==null || !desired.keySet().equals(Set.copyOf(WarehouseSettings.ROLES))) throw fail(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_ROLES");
            var ordered=new LinkedHashMap<String,List<String>>();
            for(String role:WarehouseSettings.ROLES){
                var list=desired.get(role);
                if(list==null || new HashSet<>(list).size()!=list.size() || !new HashSet<>(codes).containsAll(list)) throw fail(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_WAREHOUSE");
                if(!select && !new HashSet<>(list).equals(new HashSet<>(memberships(a,old).get(role))))throw fail(HttpStatus.UNPROCESSABLE_ENTITY,"MEMBERSHIP_CHANGED");
                ordered.put(role,select?codes.stream().filter(list::contains).toList():List.copyOf(list));
            }
            return new LocalPin(old.slots(),old.materials(),ordered);
        });
        String next=select?"priority":"done";
        if(select) session.setAttribute(GRANT,new Grant(a.key(),g.id(),next,state.version()));else session.removeAttribute(GRANT);
        return ok(new WarehouseView(g.id(),next,state.version(),warehousePlant(a),true,display(a,"warehouse",candidates),new WarehouseSettings.Rules(memberships(a,state.pin()))));
    }
}
