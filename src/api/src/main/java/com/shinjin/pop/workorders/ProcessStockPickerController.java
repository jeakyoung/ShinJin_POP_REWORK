package com.shinjin.pop.workorders;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/work-orders/{date}/{sequence}/stock-picker")
class ProcessStockPickerController {
    record Place(String code, String name) {}
    record ScanPlace(String warehouse, String raw, Place location) {}
    record Answer(String division, String warehouse, String status, BigDecimal thickness, BigDecimal width,
                  BigDecimal length, List<ProcessLotLookup.Candidate> rows) {}
    record Remnant(String workCode, String warehouse, String status, BigDecimal size) {}
    record Catalog(String terminal, String factory, String order, int line, String plant, String status,
                   List<String> remnantGrades, List<Place> issue, List<Place> auxiliary, List<ScanPlace> locations,
                   List<Remnant> remnantRoutes, List<Answer> answers) {}
    record State(ProcessLotLookup.Scope scope, Catalog catalog, List<Place> issue, List<Place> auxiliary) {}
    record View(List<Place> issue, List<Place> auxiliary, String initial, String quality, String thickness, String width) {}
    record Choice(String role, String code) {}
    record Lookup(String role, String warehouse, BigDecimal thickness, BigDecimal width) {}
    record Location(String warehouse, String raw) {}
    record Remnants(boolean eligible, List<ProcessLotLookup.Candidate> rows) {}
    record Device(String terminal, String factory) {}

    private final ProcessLotLookup plans;
    private final TerminalSettingsDemoController settings;
    private final List<Catalog> catalogs;
    private final Map<Device,String> fixed = new ConcurrentHashMap<>();

    ProcessStockPickerController(ProcessLotLookup plans, TerminalSettingsDemoController settings, ObjectMapper mapper)
            throws IOException {
        this.plans = plans;
        this.settings = settings;
        try (var input = new ClassPathResource("demo/process-stock-picker.json").getInputStream()) {
            catalogs = List.of(mapper.readValue(input, Catalog[].class));
        }
    }

    private State state(LocalDate date, int sequence, Integer slot, HttpServletRequest request) {
        var scope = plans.scope(date, sequence, slot, request);
        var terminal = scope.actor().terminal();
        var plan = scope.detail().plan();
        var catalog = catalogs.stream().filter(c -> c.terminal().equals(terminal.id()) && c.factory().equals(terminal.factory())
                && c.order().equals(plan.orderNumber()) && c.line() == plan.orderLine()).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        var roles = settings.pinnedWarehouseRoles(request);
        var policy = settings.lotPolicy(scope.actor(), request);
        var main = catalog.issue().stream().filter(p -> policy.allowsIssue(p.code())
                && roles.map(r -> r.getOrDefault("issue",List.of()).contains(p.code())).orElse(true)).toList();
        if (main.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT);
        var auxiliary = catalog.auxiliary().stream().filter(p ->
                roles.map(r -> r.getOrDefault("auxiliary",List.of()).contains(p.code())).orElse(true)).toList();
        return new State(scope,catalog,main,auxiliary);
    }

    private static Device device(State s) { return new Device(s.catalog().terminal(),s.catalog().factory()); }

    @GetMapping
    View view(@PathVariable LocalDate date, @PathVariable int sequence, @RequestParam(required=false) Integer slot,
              HttpServletRequest request) {
        var s = state(date,sequence,slot,request);
        var display = s.scope().detail().plan().getDisplay();
        // FnIniLoad puts the fixed code into the primary lookup, even when previously saved by the auxiliary editor.
        String code = fixed.getOrDefault(device(s),s.issue().get(0).code());
        boolean visible = java.util.stream.Stream.concat(s.issue().stream(),s.auxiliary().stream()).anyMatch(p -> p.code().equals(code));
        return new View(s.issue(),s.auxiliary(),visible ? code : "",display.quality(),display.thickness(),display.width());
    }

    private static void checkPlace(State s, String role, String code) {
        var options = switch (role == null ? "" : role) {
            case "issue" -> s.issue();
            case "auxiliary" -> s.auxiliary();
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        };
        if (options.stream().noneMatch(p -> p.code().equals(code)))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private boolean restoredAuxiliary(State s, String code) {
        return code.equals(fixed.get(device(s))) && s.auxiliary().stream().anyMatch(p -> p.code().equals(code));
    }

    @PutMapping("/fixed")
    Choice fix(@PathVariable LocalDate date, @PathVariable int sequence, @RequestParam(required=false) Integer slot,
             @RequestBody Choice choice, HttpServletRequest request) {
        var s = state(date,sequence,slot,request);
        checkPlace(s,choice.role(),choice.code());
        fixed.put(device(s),choice.code());
        return choice;
    }

    private record PickKey(LocalDate date,int sequence,int slot,String warehouse,String location,String lot,String material) {}
    private record Selection(Lookup stock,boolean remnant) {}
    private static final String RECALLED = ProcessStockPickerController.class.getName()+".selections";
    @SuppressWarnings("unchecked")
    private Map<PickKey,Selection> selections(HttpServletRequest request) {
        var session=request.getSession(false);
        synchronized(session) {
            var previous=session.getAttribute(RECALLED);
            if(previous instanceof Map<?,?>) return (Map<PickKey,Selection>) previous;
            Map<PickKey,Selection> result=new ConcurrentHashMap<>();
            session.setAttribute(RECALLED,result);
            return result;
        }
    }
    private void remember(List<ProcessLotLookup.Candidate> rows, LocalDate date,int sequence,int slot,Selection selection,HttpServletRequest request) {
        var seen=selections(request);
        for(var row:rows) seen.put(new PickKey(date,sequence,slot,row.warehouse(),row.location(),row.lot(),row.material()),selection);
    }
    ProcessLotLookup.Candidate selected(LocalDate date,int sequence,int slot,String warehouse,String location,String lot,String material,
                                        HttpServletRequest request) {
        var s=state(date,sequence,slot,request);
        var prior=selections(request).get(new PickKey(date,sequence,slot,warehouse,location,lot,material));
        if(prior==null) return null;
        var rows=prior.remnant() ? availableRemnants(s,slot).rows() : availableStock(s,prior.stock());
        return rows.stream().filter(row->row.warehouse().equals(warehouse) && row.location().equals(location)
                && row.lot().equals(lot) && row.material().equals(material)).findFirst().orElse(null);
    }

    // These are explicit synthetic result sets for known argument tuples, independent of production SP semantics.
    private static List<ProcessLotLookup.Candidate> answers(Catalog c, String division, String warehouse,
            String status, BigDecimal thickness, BigDecimal width, BigDecimal length) {
        return c.answers().stream().filter(a -> a.division().equals(division) && a.warehouse().equals(warehouse)
                && a.status().equals(status) && a.thickness().compareTo(thickness)==0 && a.width().compareTo(width)==0
                && a.length().compareTo(length)==0).flatMap(a -> a.rows().stream()).toList();
    }

    @PostMapping("/stock")
    List<ProcessLotLookup.Candidate> stock(@PathVariable LocalDate date, @PathVariable int sequence, @RequestParam int slot,
            @RequestBody Lookup q, HttpServletRequest request) {
        var rows=availableStock(state(date,sequence,slot,request),q);
        remember(rows,date,sequence,slot,new Selection(q,false),request);
        return rows;
    }

    private List<ProcessLotLookup.Candidate> availableStock(State s,Lookup q) {
        if (q.warehouse()==null || q.thickness()==null || q.width()==null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        if (!q.warehouse().isEmpty()) {
            boolean restoredAux = "issue".equals(q.role()) && restoredAuxiliary(s,q.warehouse());
            if (!restoredAux) checkPlace(s,q.role(),q.warehouse());
        }
        else if (!"issue".equals(q.role())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return answers(s.catalog(),"SELECT",q.warehouse(),s.catalog().status(),q.thickness(),q.width(),BigDecimal.ZERO)
                .stream().filter(row -> s.issue().stream().anyMatch(p->p.code().equals(row.warehouse()))
                        || s.auxiliary().stream().anyMatch(p->p.code().equals(row.warehouse()))).toList();
    }

    @PostMapping("/remnants")
    Remnants remnants(@PathVariable LocalDate date, @PathVariable int sequence, @RequestParam int slot,
                      HttpServletRequest request) {
        var found=availableRemnants(state(date,sequence,slot,request),slot);
        remember(found.rows(),date,sequence,slot,new Selection(null,true),request);
        return found;
    }

    private Remnants availableRemnants(State s,int slot) {
        var c = s.catalog();
        String gradeKey = c.order()+"."+c.line()+".mat_quacode";
        var columns = java.util.ResourceBundle.getBundle("demo.work-order-columns", java.util.Locale.ROOT);
        if (!columns.containsKey(gradeKey) || java.util.Arrays.stream(columns.getString(gradeKey).split(","))
                .noneMatch(c.remnantGrades()::contains)) return new Remnants(false,List.of());
        String work = s.scope().actor().workCodes().get(slot);
        var route = c.remnantRoutes().stream().filter(v -> v.workCode().equals(work)).findFirst()
                .or(() -> c.remnantRoutes().stream().filter(v -> v.workCode().equals("*")).findFirst()).orElseThrow();
        return new Remnants(true,answers(c,"SELECT2",route.warehouse(),route.status(),route.size(),route.size(),route.size()));
    }

    @PostMapping("/location")
    List<Place> location(@PathVariable LocalDate date, @PathVariable int sequence, @RequestParam(required=false) Integer slot,
                         @RequestBody Location query, HttpServletRequest request) {
        var s = state(date,sequence,slot,request);
        if (query.warehouse()==null || query.raw()==null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        if (!query.warehouse().isEmpty() && !restoredAuxiliary(s,query.warehouse())) checkPlace(s,"issue",query.warehouse());
        return s.catalog().locations().stream().filter(p -> p.warehouse().equals(query.warehouse())
                && p.raw().equals(query.raw())).map(ScanPlace::location).limit(1).toList();
    }
}
