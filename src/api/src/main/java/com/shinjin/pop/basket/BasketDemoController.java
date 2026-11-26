package com.shinjin.pop.basket;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import synthetic.basket.BasketDomain;
import synthetic.basket.BasketDomain.*;
import synthetic.basket.InMemoryBasketDomain;

import java.math.BigDecimal;
import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/work-baskets")
public final class BasketDemoController {
    private static final Scope CENTER_003 = new Scope("FACTORY-DEMO", "SITE-NORTH", "CENTER-003");
    private static final Scope CENTER_103 = new Scope("FACTORY-DEMO", "SITE-NORTH", "CENTER-103");
    private static final Scope CHECKED = new Scope("FACTORY-DEMO", "SITE-SOUTH", "CENTER-CHECKED-DEMO");
    private static final Lot LOT = new Lot("ITEM-DEMO", "LOT-DEMO", "WAREHOUSE-DEMO", "BIN-DEMO");
    private static final Lot RETURN = new Lot("ITEM-DEMO", "LOT-RETURN-DEMO", "WAREHOUSE-DEMO", "BIN-RETURN-DEMO");

    private final BasketDomain domain;
    private final BasketScanData scans;
    private final BasketStockCatalog picker;
    record ProcessRows(String terminal,String workCode,List<PlanKey> plans) {}
    private final List<ProcessRows> processRows;

    public record Failure(String code) {}
    public record GroupDetail(long revision, Group group, List<Material> materials, List<DisplayLot> displayLots) {}
    private final List<DisplayLot> displayLots;
    public record PlanEntry(String terminal,PlanKey key,Columns columns) {}
    private final List<PlanEntry> planColumns;

    public BasketDemoController(@Value("${shinjin.demo.basket-materials:classpath:demo/basket-materials.json}") Resource dataset,
            @Value("${shinjin.demo.basket-plan-columns:classpath:demo/basket-plan-columns.json}") Resource planFile,
            @Value("${shinjin.demo.basket-processes:classpath:demo/basket-processes.json}") Resource processes,
            BasketScanData scans,BasketStockCatalog picker)
            throws IOException {
        this.scans=scans;
        this.picker=picker;
        try (var in = dataset.getInputStream()) {
            displayLots = List.of(JsonMapper.builder().build().readValue(in, DisplayLot[].class));
        }
        try(var in=planFile.getInputStream()){planColumns=List.of(JsonMapper.builder().build().readValue(in,PlanEntry[].class));}
        try(var in=processes.getInputStream()){processRows=List.of(JsonMapper.builder().build().readValue(in,ProcessRows[].class));}
        domain = new InMemoryBasketDomain(Clock.systemDefaultZone(), Map.of(CENTER_003, seed("DEMO-A", Mode.BASKET),
                CENTER_103, seed("DEMO-A2", Mode.BASKET), CHECKED, seed("DEMO-B", Mode.CHECKED_LIST)), displayLots);
    }

    @GetMapping
    public ResponseEntity<?> view(HttpServletRequest request) {
        return response(scopedView(actor(request)));
    }

    View pickerView(HttpServletRequest request) {
        var owner=actor(request);
        if(owner.workCode()==null)throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        var reply=scopedView(owner);
        if(reply.status()!=200)throw new ResponseStatusException(HttpStatus.valueOf(reply.status()));
        return reply.value();
    }

    private record Selection(Actor actor,String slot,PlanKey plan) {}
    private static final class PickerSession {
        final Map<Selection,Set<DisplayLot>> resolvedReturns=new java.util.HashMap<>();
        final Map<Selection,Set<Lot>> seen = new java.util.HashMap<>();
    }
    private static PickerSession pickerSession(HttpServletRequest request) {
        var session=request.getSession(false);
        if(session==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        synchronized(session){
            var data=(PickerSession)session.getAttribute(PickerSession.class.getName());
            if(data==null){data=new PickerSession();session.setAttribute(PickerSession.class.getName(),data);}
            return data;
        }
    }
    void rememberStock(HttpServletRequest request,Actor owner,PlanKey plan,List<BasketStockCatalog.Candidate> rows) {
        var data=pickerSession(request);
        var selection=new Selection(owner,request.getHeader("X-Pop-Process-Slot"),plan);
        synchronized(data){
            var seen=data.seen.computeIfAbsent(selection,ignored->new java.util.HashSet<>());
            for(var row:rows)seen.add(new Lot(row.material(),row.lot(),row.warehouse(),row.location()));
        }
    }
    void rememberReturn(HttpServletRequest request,Actor actor,PlanKey plan,DisplayLot result){
        var data=pickerSession(request);
        synchronized(data){data.resolvedReturns.computeIfAbsent(new Selection(actor,request.getHeader("X-Pop-Process-Slot"),plan),
                unused->new java.util.HashSet<>()).add(result);}
    }
    boolean recognizesReturn(HttpServletRequest request,View view,Work focus,DisplayLot candidate){
        var data=pickerSession(request);List<DisplayLot> seen=new java.util.ArrayList<>();
        synchronized(data){
            seen.addAll(data.resolvedReturns.getOrDefault(new Selection(view.actor(),request.getHeader("X-Pop-Process-Slot"),focus.plan().key()),Set.of()));
        }
        view.groups().stream().filter(g->g.id().equals(focus.groupId())).forEach(g->{
            g.returns().forEach(r->seen.add(r.material()));g.productionReturns().forEach(r->seen.add(r.material()));
        });
        return seen.stream().filter(java.util.Objects::nonNull).anyMatch(s->s.lot().equals(candidate.lot()) && java.util.Objects.equals(s.qualityCode(),candidate.qualityCode())
                && java.util.Objects.equals(s.qualityName(),candidate.qualityName()) && s.thickness().compareTo(candidate.thickness())==0
                && s.width().compareTo(candidate.width())==0);
    }

    @GetMapping("/scan")
    public ResponseEntity<?> scanEntry(HttpServletRequest request) {
        var owner=actor(request);
        if(owner.workCode()==null)return failure(403,"WORK_CODE_REQUIRED");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("configured",scans.configured(owner.terminal(),request)));
    }

    public record ScanRequest(String barcode) {}
    @PostMapping(path="/scan", consumes="application/json")
    public ResponseEntity<?> scan(@RequestBody ScanRequest body,HttpServletRequest request) {
        var owner=actor(request);
        if(owner.workCode()==null)return failure(403,"WORK_CODE_REQUIRED");
        var visible=scopedView(owner);
        if(visible.status()!=200)return response(visible);
        return response(scans.scan(body.barcode(),visible.value(),request));
    }

    public List<String> parentQualities(HttpServletRequest request,List<PlanKey> keys) {
        var view=scopedView(actor(request));
        if(view.status()!=200)throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return keys.stream().map(key->view.value().work().stream().map(Work::plan).filter(p->p.key().equals(key))
            .findFirst().map(p->p.columns()==null || p.columns().quality()==null?"":p.columns().quality())
            .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"PARENT_PLAN_NOT_FOUND"))).toList();
    }

    @GetMapping("/groups/{groupId}")
    public ResponseEntity<?> group(@PathVariable("groupId") String groupId, HttpServletRequest request) {
        var actor = actor(request);
        var reply = scopedView(actor);
        if (reply.status() != 200) return response(reply);
        var view = reply.value();
        var group = view.groups().stream().filter(row -> row.id().equals(groupId)).findFirst().orElse(null);
        if (group == null) return failure(404, "GROUP_NOT_FOUND");
        if (!group.terminal().equals(actor.terminal())) return failure(403, "GROUP_TERMINAL_MISMATCH");
        if (view.mode() != Mode.BASKET || group.startedAt() != null) return failure(409, "BASKET_REQUIRED");
        var lots = new java.util.HashSet<Lot>();
        group.issues().forEach(row -> lots.add(row.lot()));
        group.returns().forEach(row -> lots.add(row.lot()));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new GroupDetail(
                view.revision(), group, view.materials(), displayLots.stream().filter(row -> lots.contains(row.lot())).toList()));
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public synchronized ResponseEntity<?> command(HttpServletRequest request, @RequestBody Command command) {
        var actor=actor(request);
        if(command!=null && (command.action()==Action.REMOVE_ISSUE_ROWS || command.action()==Action.REMOVE_RETURN_ROWS)
                && actor.workCode()==null)return failure(403,"WORK_CODE_REQUIRED");
        if(actor.workCode()!=null&&command!=null){
            var allowed=plans(actor.terminal(),actor.workCode());
            if(command.visible()!=null&&!allowed.containsAll(command.visible())||command.selected()!=null&&!allowed.containsAll(command.selected()))
                return failure(403,"WORK_CODE_MISMATCH");
            if(command.groupId()!=null){
                var all=domain.view(actor);
                if(all.status()!=200)return response(all);
                if(all.value().work().stream().anyMatch(w->command.groupId().equals(w.groupId())&&!allowed.contains(w.plan().key())))
                    return failure(404,"GROUP_NOT_FOUND");
            }
        }
        if(command!=null && command.action()==Action.ADD_MANUAL_ISSUE){
            if(actor.workCode()==null || command.visible().size()!=1)return failure(403,"WORK_CODE_REQUIRED");
            var data=pickerSession(request);
            var selection=new Selection(actor,request.getHeader("X-Pop-Process-Slot"),command.visible().get(0));
            Set<Lot> seen;
            synchronized(data){seen=Set.copyOf(data.seen.getOrDefault(selection,Set.of()));}
            return response(domain.execute(actor,command,seen));
        }
        if(command!=null && (command.action()==Action.SAVE_RETURN_GRID || command.returns().stream().anyMatch(line->line.material()!=null))){
            if(actor.workCode()==null)return failure(403,"WORK_CODE_REQUIRED");
            var data=pickerSession(request);Set<DisplayLot> resolved=new java.util.HashSet<>();
            synchronized(data){
                for(var plan:command.visible())resolved.addAll(data.resolvedReturns.getOrDefault(
                        new Selection(actor,request.getHeader("X-Pop-Process-Slot"),plan),Set.of()));
            }
            return response(domain.execute(actor,command,Set.of(),resolved));
        }
        return response(domain.execute(actor,command));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Failure> malformed() { return failure(400, "MALFORMED_COMMAND"); }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Failure> identityFailure(ResponseStatusException error) {
        int status = error.getStatusCode().value();
        return failure(status, status == 401 ? "LOGIN_REQUIRED" : "TERMINAL_OUT_OF_SCOPE");
    }

    private static String workCode(HttpServletRequest request,DemoSessionController.Identity identity){
        String slot=request.getHeader("X-Pop-Process-Slot"),code=request.getHeader("X-Pop-Work-Code");
        if(slot==null&&(code==null||code.isBlank()))return null;
        if(identity.groupWork()||!Set.of("003","103").contains(identity.workCenterCode())||code==null||code.isBlank())
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if(identity.processSlots().stream().noneMatch(n->(slot==null||slot.equals(n.toString()))&&code.equals(identity.workCodes().get(n))))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return code;
    }
    private Set<PlanKey> plans(String terminal,String code){
        return processRows.stream().filter(p->terminal.equals(p.terminal())&&code.equals(p.workCode()))
                .flatMap(p->p.plans().stream()).collect(java.util.stream.Collectors.toSet());
    }
    private Reply<View> scopedView(Actor actor){
        var reply=domain.view(actor);
        if(actor.workCode()==null||reply.status()!=200)return reply;
        var allowed=plans(actor.terminal(),actor.workCode());var v=reply.value();
        var work=v.work().stream().filter(row->allowed.contains(row.plan().key())).toList();
        var ids=work.stream().map(Work::groupId).filter(java.util.Objects::nonNull).collect(java.util.stream.Collectors.toSet());
        var site=picker.site(actor.terminal());
        var materials=v.materials().stream().map(m->new Material(m.lot(),m.available(),site==null?null:
                site.stocks().stream().map(BasketStockCatalog.Stock::spec).filter(s->s.lot().equals(m.lot())).findFirst().orElse(null))).toList();
        return new Reply<>(200,null,new View(actor,v.mode(),v.canWrite(),v.revision(),work,v.groups().stream().filter(g->ids.contains(g.id())).toList(),
                work.isEmpty()?List.of():materials,work.isEmpty()?List.of():v.returnCandidates()));
    }

    private static Actor actor(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        String terminal = identity.terminal().id();
        Scope scope = switch (terminal) {
            case "DEMO-A" -> CENTER_003;
            case "DEMO-A2" -> CENTER_103;
            case "DEMO-B" -> CHECKED;
            default -> throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Basket terminal unavailable");
        };
        return new Actor(scope,terminal,identity.worker().id(),workCode(request,identity));
    }

    private static ResponseEntity<?> response(Reply<?> reply) {
        if (reply.status() != 200) return failure(reply.status(), reply.error());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(reply.value());
    }

    private static ResponseEntity<Failure> failure(int status, String code) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new Failure(code));
    }

    private Seed seed(String terminal, Mode mode) {
        boolean started = mode == Mode.CHECKED_LIST;
        Group group = new Group("GROUP-DEMO-CHECKED", terminal, List.of(new Issue(LOT, BigDecimal.ONE)),
                List.of(), Instant.parse("2030-01-01T01:00:00Z"));
        Phase phase = started ? Phase.STARTED : Phase.READY;
        String id = started ? group.id() : null;
        return new Seed(mode, Map.of(terminal, true),
                List.of(work(terminal, 1, phase, id), work(terminal, 2, phase, id),
                        work(terminal, 3, Phase.COMPLETED, null)),
                started ? List.of(group) : List.of(), picker.inventory(terminal,Map.of(LOT, BigDecimal.TEN)), Set.of(RETURN));
    }

    private Work work(String terminal, int sequence, Phase phase, String id) {
        var key = new PlanKey(LocalDate.of(2030, 1, terminal.equals("DEMO-A") ? 1 : terminal.equals("DEMO-A2") ? 2 : 3), sequence);
        var columns=planColumns.stream().filter(r->r.terminal().equals(terminal) && r.key().equals(key)).map(PlanEntry::columns).findFirst().orElse(null);
        return new Work(new Plan(key, "ORDER-" + terminal, sequence, LOT.item(),columns), phase, id);
    }
}
