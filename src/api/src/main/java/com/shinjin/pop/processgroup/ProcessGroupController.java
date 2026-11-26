package com.shinjin.pop.processgroup;

import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.admin.EquipmentSettingsController;
import com.shinjin.pop.history.WorkHistoryFixtures;
import com.shinjin.pop.history.WorkHistoryFixtures.Stage;
import com.shinjin.pop.history.WorkHistoryFixtures.Station;
import com.shinjin.pop.workorders.ProductionCatalog;
import com.shinjin.pop.workorders.WorkDefects;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.util.*;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/process-group-demo")
public final class ProcessGroupController {
    public record Line(String plan, BigDecimal good, BigDecimal bad) {}
    public record Entry(String plan, Stage stage, BigDecimal good, BigDecimal bad) {}
    public record ReturnRow(String id, String warehouse, String location, BigDecimal thickness, BigDecimal width, BigDecimal length, BigDecimal quantity, String item) {}
    public record CompletedReturns(List<String> plans, List<ReturnRow> rows) {}
    public record ActiveInput(UUID groupId, boolean paused, int quantity) {}
    public record CompletedInput(UUID groupId, List<String> plans, String lot, int quantity,List<GroupMaterialStock.Pick> scanned) {}
    public record View(Station setting, int revision, List<String> ready, List<String> started, List<Entry> results, GroupReturnCatalog.Material material, List<ReturnRow> returns, List<CompletedReturns> completedReturns, ActiveInput activeInput, List<CompletedInput> completedInputs, Map<String,BigDecimal> badTotals,List<GroupMaterialStock.Pick> scanned) {}
    public record Command(Integer revision, String action, List<Line> lines, List<ReturnRow> returns, List<String> returnIds, UUID groupId, BigDecimal inputQuantity,List<GroupMaterialStock.Addition> inputs) {}
    private record Scope(String terminal, String worker, String profile,String plant,String center) {}

    private final WorkHistoryFixtures fixtures;
    private final GroupReturnCatalog catalog;
    private final WorkDefects defects = new WorkDefects();
    private final ProductionCatalog production;
    private final GroupMaterialStock stock;
    public ProcessGroupController(WorkHistoryFixtures fixtures, GroupReturnCatalog catalog, ProductionCatalog production,GroupMaterialStock stock) { this.stock=stock; this.production=production; this.fixtures = fixtures; this.catalog=catalog; }

    private final Map<Scope, View> ledgers = new HashMap<>();

    private Scope scope(HttpServletRequest request, String profile) {
        var identity = DemoSessionController.requireIdentity(request);
        var assigned = EquipmentSettingsController.appliedStation(fixtures.station(identity.terminal().id()), request);
        if (assigned == null || !assigned.groupCenter() || (profile != null && !profile.equals(assigned.profile())))
            throw error(HttpStatus.FORBIDDEN, "GROUP_TERMINAL_REQUIRED");
        return new Scope(identity.terminal().id(), identity.worker().id(), assigned.profile(),EquipmentSettingsController.appliedPlant(request),assigned.center());
    }

    private View view(Scope scope, HttpServletRequest request) {
        var prior = ledgers.get(scope);
        // Finish an already started batch against its original process sequence.
        if (prior != null && !prior.started().isEmpty()) return prior;
        var setting = EquipmentSettingsController.appliedStation(fixtures.station(scope.terminal()), request);
        return prior == null ? new View(setting, 0, List.of("PLAN-A", "PLAN-B", "PLAN-C"), List.of(), List.of(), catalog.forTerminal(scope.terminal()), List.of(), List.of(), null, List.of(), Map.of(), List.of())
                : new View(setting, prior.revision(), prior.ready(), prior.started(), prior.results(), prior.material(), prior.returns(), prior.completedReturns(), prior.activeInput(), prior.completedInputs(), prior.badTotals(),prior.scanned());
    }

    private static final class DefectFailure extends ResponseStatusException {
        DefectFailure(HttpStatus status,String code) {super(status,code);}
    }
    @ExceptionHandler(DefectFailure.class)
    public org.springframework.http.ResponseEntity<Map<String,String>> defectError(DefectFailure e) {
        return org.springframework.http.ResponseEntity.status(e.getStatusCode()).body(Map.of("code",e.getReason()));
    }
    private View defectParent(Scope scope, UUID group, String plan, HttpServletRequest request) {
        var parent=view(scope,request);
        if(parent.activeInput()==null || !group.equals(parent.activeInput().groupId()) || !parent.started().contains(plan))
            throw new DefectFailure(HttpStatus.CONFLICT,"STARTED_WORK_REQUIRED");
        if(production.terminal(scope.terminal(),request).bad().isEmpty()) throw new DefectFailure(HttpStatus.CONFLICT,"BAD_WAREHOUSE_REQUIRED");
        return parent;
    }
    @GetMapping("/groups/{group}/plans/{plan}/rejections")
    public synchronized WorkDefects.View defects(@PathVariable UUID group,@PathVariable String plan,HttpServletRequest request) {
        var scope=scope(request,null);
        var parent=defectParent(scope,group,plan,request);
        return defects.view(group+"/"+plan,parent.revision(),production.terminal(scope.terminal(),request));
    }
    @PostMapping("/groups/{group}/plans/{plan}/rejections")
    public synchronized WorkDefects.View saveDefects(@PathVariable UUID group,@PathVariable String plan,@RequestBody WorkDefects.Command cmd,HttpServletRequest request) {
        var scope=scope(request,null);
        var parent=defectParent(scope,group,plan,request);
        String key=group+"/"+plan;
        try {
            var prior=defects.replay(key,scope.worker(),cmd);
            if(prior!=null)return prior;
            if(parent.revision()!=cmd.revision())throw new DefectFailure(HttpStatus.CONFLICT,"STALE_REVISION");
            var saved=defects.apply(key,scope.worker(),cmd,production.terminal(scope.terminal(),request));
            var totals=new HashMap<>(parent.badTotals());
            totals.put(plan,saved.saved().total());
            ledgers.put(scope,new View(parent.setting(),parent.revision()+1,parent.ready(),parent.started(),parent.results(),parent.material(),
                    parent.returns(),parent.completedReturns(),parent.activeInput(),parent.completedInputs(),Map.copyOf(totals),parent.scanned()));
            return saved;
        } catch(IllegalArgumentException e){throw new DefectFailure(HttpStatus.UNPROCESSABLE_ENTITY,e.getMessage());}
          catch(IllegalStateException e){throw new DefectFailure(HttpStatus.CONFLICT,e.getMessage());}
    }

    private List<String> issueWarehouses(View parent, Scope scope, HttpServletRequest request) {
        if(parent.started().isEmpty() && parent.ready().isEmpty())
            throw error(HttpStatus.CONFLICT,"WORK_LIST_REQUIRED");
        var visible=parent.started().isEmpty()?parent.ready():parent.started();
        if(parent.results().stream().anyMatch(result->visible.contains(result.plan())))
            throw error(HttpStatus.CONFLICT,"FINISHED_WORK_ORDER");
        var warehouses=production.terminal(scope.terminal(),request).issue();
        if(warehouses.isEmpty())throw error(HttpStatus.CONFLICT,"ISSUE_WAREHOUSE_REQUIRED");
        return warehouses;
    }

    public record Place(String code,String name) {}
    public record Picker(List<Place> issue,List<Place> auxiliary,String initial,String quality,BigDecimal thickness,BigDecimal width) {}
    @GetMapping("/input-material")
    public synchronized Picker materialContext(HttpServletRequest request) {
        var scope=scope(request,null);
        var parent=view(scope,request);
        var stores=issueWarehouses(parent,scope,request);
        var spec=parent.material();
        return new Picker(stores.stream().map(w->new Place(w,w)).toList(),List.of(),stores.get(0),
                spec==null?"":spec.grade(),spec==null?null:spec.thickness(),spec==null?null:spec.width());
    }

    private List<GroupMaterialStock.Stock> candidates(View parent,Scope scope,String raw,String requestedCode,HttpServletRequest request) {
        var stores=issueWarehouses(parent,scope,request);
        var actor=DemoSessionController.requireIdentity(request);
        var stages=parent.setting().stages();
        var first=stages.isEmpty()?"":Objects.toString(stages.get(0).processCode(),"");
        String code=requestedCode==null?first:requestedCode;
        if(!code.equals(first) && !actor.workCodes().containsValue(code))throw error(HttpStatus.FORBIDDEN,"WORK_CODE_SCOPE");
        return stock.lookup(scope.terminal(),actor.terminal().factory(),scope.plant(),parent.setting().center(),stores,code,parent.material(),raw);
    }

    @PostMapping("/input-material")
    public synchronized List<GroupMaterialStock.Stock> scanMaterial(@RequestBody GroupMaterialStock.Scan cmd,
            @RequestHeader(value="X-Pop-Work-Code",required=false) String code,HttpServletRequest request) {
        var scope=scope(request,null);
        return candidates(view(scope,request),scope,cmd.raw(),code,request);
    }

    private List<GroupMaterialStock.Pick> checkedInputs(View parent,Scope scope,Command cmd,HttpServletRequest request){
        if(cmd.inputs()==null)return parent.scanned();
        var rows=new ArrayList<GroupMaterialStock.Pick>();
        var seen=new HashSet<GroupMaterialStock.Stock>();
        for(var add:cmd.inputs()){
            if(add==null || add.quantity()<1)throw error(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_QUANTITY");
            var item=candidates(parent,scope,add.lot(),request.getHeader("X-Pop-Work-Code"),request).stream()
                    .filter(s->s.warehouse().equals(add.warehouse())&&s.location().equals(add.location())&&s.material().equals(add.material()))
                    .findFirst().orElseThrow(()->error(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_LOCATION"));
            if(!seen.add(item) || add.quantity()>item.available())throw error(HttpStatus.UNPROCESSABLE_ENTITY,"MATERIAL_STOCK_LIMIT");
            rows.add(new GroupMaterialStock.Pick(item,add.quantity()));
        }
        return List.copyOf(rows);
    }

    @GetMapping({"", "/{profile}"})
    public synchronized View find(HttpServletRequest request, @PathVariable(name = "profile", required = false) String profile) {
        return view(scope(request, profile), request);
    }

    @PostMapping({"", "/{profile}"})
    public synchronized View apply(HttpServletRequest request, @PathVariable(name = "profile", required = false) String profile, @RequestBody Command command) {
        Scope scope = scope(request, profile);
        View before = view(scope, request);
        var setting = before.setting();
        if (!Objects.equals(before.revision(), command.revision())) throw error(HttpStatus.CONFLICT, "STALE_REVISION");
        boolean posting="START".equals(command.action()) || "FINISH".equals(command.action());
        var inputs=posting?checkedInputs(before,scope,command,request):before.scanned();
        if(posting && (setting.stages().isEmpty() || (setting.inputQty()<1 && inputs.isEmpty())))
            throw error(HttpStatus.CONFLICT,"GROUP_NOT_CONFIGURED");
        boolean stop = "STOP".equals(command.action());
        if (stop || "RESTART".equals(command.action())) {
            var input = requireGroup(before, command);
            if (input.paused() == stop) throw error(HttpStatus.CONFLICT, "WRONG_GROUP_STATE");
            var next = new View(setting, before.revision() + 1, before.ready(), before.started(), before.results(),
                    before.material(), before.returns(), before.completedReturns(),
                    new ActiveInput(input.groupId(), stop, input.quantity()), before.completedInputs(), before.badTotals(),before.scanned());
            ledgers.put(scope, next);
            return next;
        }
        if ("DELETE_RETURNS".equals(command.action())) {
            var ids = command.returnIds();
            if (ids == null || ids.isEmpty() || ids.stream().anyMatch(Objects::isNull) || new HashSet<>(ids).size()!=ids.size())
                throw error(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_SELECTION");
            var rows = new ArrayList<>(before.returns());
            for (String id : ids) {
                var row = rows.stream().filter(r -> r.id().equals(id)).findFirst().orElseThrow(() -> error(HttpStatus.CONFLICT, "ROW_MISSING"));
                if (before.material().warehouse(row.warehouse()).scrap()) throw error(HttpStatus.CONFLICT,"SCRAP_DELETE");
                rows.remove(row);
            }
            var after = new View(setting,before.revision()+1,before.ready(),before.started(),before.results(),before.material(),List.copyOf(rows),before.completedReturns(),before.activeInput(),before.completedInputs(), before.badTotals(),before.scanned());
            ledgers.put(scope,after);
            return after;
        }
        if (command.lines() == null || command.lines().isEmpty() || command.lines().size() > 3)
            throw error(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_SELECTION");
        Set<String> selected = new LinkedHashSet<>();
        for (Line line : command.lines()) {
            if (line == null || line.plan() == null || !selected.add(line.plan()))
                throw error(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_SELECTION");
        }
        var ready = new ArrayList<>(before.ready());
        var results = new ArrayList<>(before.results());
        List<String> started;
        var returns = before.returns();
        var completed = new ArrayList<>(before.completedReturns());
        var input = before.activeInput();
        var completedInputs = new ArrayList<>(before.completedInputs());
        if ("START".equals(command.action())) {
            if (!before.started().isEmpty() || !ready.containsAll(selected)) throw error(HttpStatus.CONFLICT, "NOT_READY");
            returns = validateReturns(before,command,false);
            int quantity = inputQuantity(command.inputQuantity(), setting.inputQty(), setting.inputQty(), 0);
            input = new ActiveInput(UUID.randomUUID(), false, quantity);
            ready.removeAll(selected);
            started = List.copyOf(selected);
        } else if ("FINISH".equals(command.action())) {
            if (!selected.equals(new HashSet<>(before.started()))) throw error(HttpStatus.CONFLICT, "STARTED_LIST_REQUIRED");
            // Older demo clients send only the full started list and its observed revision.
            if (command.inputQuantity() != null || command.groupId() != null) requireGroup(before, command);
            if (input == null || input.paused()) throw error(HttpStatus.CONFLICT, "GROUP_NOT_RUNNING");
            int quantity = inputQuantity(command.inputQuantity(), input.quantity(), setting.inputQty(), inputs.isEmpty()?1:0);
            for (Line line : command.lines()) {
                if (before.badTotals().containsKey(line.plan()) && (line.bad()==null || before.badTotals().get(line.plan()).compareTo(line.bad())!=0)) throw error(HttpStatus.CONFLICT,"STALE_DEFECT_TOTAL");
                if (line.good() == null || line.good().compareTo(BigDecimal.ONE) < 0 || line.bad() == null || line.bad().signum() < 0)
                    throw error(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_QUANTITY");
            }
            returns = validateReturns(before,command,true);
            if (!returns.isEmpty()) completed.add(new CompletedReturns(before.started(),returns));
            returns = List.of();
            for (Stage stage : setting.stages()) {
                for (Line line : command.lines()) results.add(new Entry(line.plan(), stage, line.good(), line.bad()));
            }
            completedInputs.add(new CompletedInput(input.groupId(), before.started(), setting.inputLot(), quantity,inputs));
            input = null;
            started = List.of();
        } else if ("DELETE".equals(command.action())) {
            boolean running = !before.started().isEmpty();
            var remaining = new ArrayList<>(before.started());
            var active = running ? remaining : ready;
            if (!active.containsAll(selected)) throw error(HttpStatus.CONFLICT,"UNFINISHED_SELECTION_REQUIRED");
            active.removeAll(selected);
            if (active.isEmpty()) returns = List.of();
            started = List.copyOf(remaining);
            if (started.isEmpty()) input = null;
        } else throw error(HttpStatus.BAD_REQUEST, "UNKNOWN_ACTION");
        var after = new View(setting, before.revision() + 1, List.copyOf(ready), started, List.copyOf(results), before.material(), returns, List.copyOf(completed), input, List.copyOf(completedInputs), input == null ? Map.of() : before.badTotals().entrySet().stream().filter(e -> started.contains(e.getKey())).collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getKey,Map.Entry::getValue)),
                "FINISH".equals(command.action()) || ("DELETE".equals(command.action()) && (before.started().isEmpty()?ready:started).isEmpty()) ? List.of() : inputs);
        ledgers.put(scope, after);
        // The just-finished group keeps its own results; the next ready list uses the applied station.
        return view(scope, request);
    }

    private static ActiveInput requireGroup(View before, Command command) {
        var input = before.activeInput();
        if (input == null || !input.groupId().equals(command.groupId()))
            throw error(HttpStatus.CONFLICT, "ACTIVE_GROUP_REQUIRED");
        return input;
    }

    private static int inputQuantity(BigDecimal submitted, int saved, int available, int minimum) {
        var value = submitted == null ? BigDecimal.valueOf(saved) : submitted;
        if (value.stripTrailingZeros().scale() > 0 || value.compareTo(BigDecimal.valueOf(minimum)) < 0 ||
                value.compareTo(BigDecimal.valueOf(available)) > 0)
            throw error(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_INPUT_QUANTITY");
        return value.intValueExact();
    }

    public synchronized List<String> parentQualities(HttpServletRequest request) {
        View v = find(request,null);
        if (v.ready().isEmpty() && v.started().isEmpty()) return List.of();
        if (v.material()==null) throw error(HttpStatus.CONFLICT,"GROUP_PARENT_MATERIAL_UNKNOWN");
        return List.of(v.material().grade());
    }

    private static List<ReturnRow> validateReturns(View before, Command command, boolean finishing) {
        var submitted = command.returns()==null ? before.returns() : command.returns();
        var ids = new HashSet<String>();
        var validated = new ArrayList<ReturnRow>();
        for (var row : submitted) {
            if (row==null || row.id()==null || row.id().isBlank() || !ids.add(row.id()) || before.material()==null)
                throw error(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_RETURN");
            var wh = before.material().warehouse(row.warehouse());
            if (wh==null || (!wh.scrap() && wh.locations().stream().noneMatch(l -> l.code().equals(row.location()))))
                throw error(HttpStatus.UNPROCESSABLE_ENTITY,"RETURN_LOCATION");
            if (row.thickness()==null || row.width()==null || row.length()==null || row.thickness().signum()<=0 || row.width().signum()<=0 || row.length().signum()<=0)
                throw error(HttpStatus.UNPROCESSABLE_ENTITY,"RETURN_DIMENSIONS");
            if (row.quantity()==null || row.quantity().stripTrailingZeros().scale()>0 || row.quantity().signum()<0 || (finishing && !wh.scrap() && row.quantity().signum()==0))
                throw error(HttpStatus.UNPROCESSABLE_ENTITY,"RETURN_QUANTITY");
            var old = before.returns().stream().filter(r -> r.id().equals(row.id())).findFirst().orElse(null);
            if (old!=null && before.material().warehouse(old.warehouse()).scrap() &&
                    (!old.warehouse().equals(row.warehouse()) || !Objects.equals(old.location(),row.location()) || old.thickness().compareTo(row.thickness())!=0 ||
                     old.width().compareTo(row.width())!=0 || old.length().compareTo(row.length())!=0))
                throw error(HttpStatus.CONFLICT,"SCRAP_EDIT");
            String item = before.material().matches().stream().filter(m -> m.warehouse().equals(row.warehouse()) &&
                    m.thickness().compareTo(row.thickness())==0 && m.width().compareTo(row.width())==0 && m.length().compareTo(row.length())==0)
                    .map(GroupReturnCatalog.Match::item).reduce((first,last)->last).orElse(null);
            // GV2_SELECT1 leaves the existing material code on an empty result. Only accept known fixture codes.
            if (item==null && before.material().matches().stream().anyMatch(m->m.item().equals(row.item()))) item=row.item();
            validated.add(new ReturnRow(row.id(),row.warehouse(),row.location(),row.thickness(),row.width(),row.length(),row.quantity(),item));
        }
        if (!ids.containsAll(before.returns().stream().map(ReturnRow::id).toList()))
            throw error(HttpStatus.CONFLICT,"RETURN_DELETE_REQUIRED");
        return List.copyOf(validated);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public org.springframework.http.ResponseEntity<?> rejected(ResponseStatusException ex) {
        return org.springframework.http.ResponseEntity.status(ex.getStatusCode()).body(Map.of("code",Objects.toString(ex.getReason(),"INVALID_COMMAND")));
    }

    private static ResponseStatusException error(HttpStatus status, String reason) {
        return new ResponseStatusException(status, reason);
    }
}
