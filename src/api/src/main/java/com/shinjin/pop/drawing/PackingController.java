package com.shinjin.pop.drawing;

import com.shinjin.pop.admin.EquipmentSettingsController;
import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.history.WorkHistoryFixtures;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import synthetic.drawing.DrawingDomain.*;
import synthetic.drawing.InMemoryDrawingDomain;
import tools.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/packing")
public class PackingController {
    record OrderInfo(String item, String order, String customer, String material, String materialCode, String kind, LocalDate ordered, LocalDate delivery, String destination, BigDecimal thickness, BigDecimal width, BigDecimal length) {}
    record Piece(String lot, BigDecimal qty, String warehouse, String location, String item) {}
    record Member(String key, Long version, List<Piece> pieces) {}
    record Request(UUID requestId, String operatorId, Action action, List<Member> members, boolean autoLabel) {}
    record Row(String key, OrderInfo info, BigDecimal orderedQty, String availableLot, BigDecimal availableQty,
               State state, long version, String owner, boolean allowedMaterial, String startedAt, String finishedAt, List<Piece> saved) {}
    record Label(String group, String role, String device, String status) {}
    record Result(List<Row> rows, List<Label> labels) {}
    record Ticket(String terminal, UUID request) {}
    record Receipt(String operator, Request body, Result result) {}

    private final WorkHistoryFixtures fixtures;
    private final TerminalSettingsDemoController settings;
    private final InMemoryDrawingDomain domain;
    private final Map<String,OrderInfo> orders;
    private final PackingStock stock = new PackingStock();
    private final PackingScans scans = new PackingScans();
    private final Map<PlanKey,List<Piece>> completed = new HashMap<>();
    private final Map<PlanKey,String> groups = new HashMap<>();
    private final Map<Ticket,Receipt> receipts = new HashMap<>();
    private static final Set<Action> ACTIONS = Set.of(Action.STANDARD_PACK_START, Action.STANDARD_PACK_PAUSE,
            Action.STANDARD_PACK_RESUME, Action.STANDARD_PACK_FINISH, Action.STANDARD_PACK_CANCEL);

    PackingController(WorkHistoryFixtures fixtures, TerminalSettingsDemoController settings, InMemoryDrawingDomain domain) throws IOException {
        this.fixtures = fixtures;
        this.settings = settings;
        this.domain = domain;
        try (var stream = Objects.requireNonNull(getClass().getResourceAsStream("/demo/packing-orders.json"))) {
            orders = Arrays.stream(JsonMapper.builder().build().readValue(stream, OrderInfo[].class))
                    .collect(Collectors.toUnmodifiableMap(OrderInfo::item, order -> order));
        }
    }

    private Session session(HttpServletRequest request) {
        var actor = DrawingController.session(request);
        var station = EquipmentSettingsController.appliedStation(fixtures.station(actor.terminal()), request);
        if (station == null || !(station.packMenu() || station.packAuto())) throw fail(403, "PACKING_SLOT_REQUIRED");
        return actor;
    }

    @ExceptionHandler(ResponseStatusException.class)
    org.springframework.http.ResponseEntity<Map<String,String>> rejected(ResponseStatusException error) {
        return org.springframework.http.ResponseEntity.status(error.getStatusCode()).body(Map.of("error",Objects.toString(error.getReason(),"REJECTED")));
    }

    private static ResponseStatusException fail(int status, String reason) {
        return new ResponseStatusException(HttpStatus.valueOf(status), reason);
    }

    @GetMapping
    synchronized List<Row> search(HttpServletRequest request, @RequestParam(required=false) LocalDate from,
            @RequestParam(required=false) LocalDate to, @RequestParam(required=false) List<String> material,
            @RequestParam(required=false) List<String> kind) {
        var actor = session(request);
        if (from != null && to != null && from.isAfter(to)) throw fail(422, "INVALID_PERIOD");
        synchronized (domain) {
            return rows(actor, materials(actor, request)).stream().filter(r -> (from == null || !r.info.ordered.isBefore(from))
                    && (to == null || !r.info.ordered.isAfter(to)) && (material == null || material.contains(r.info.material))
                    && (kind == null || kind.contains(r.info.kind))).toList();
        }
    }

    record ScanRequest(String terminalId, String operatorId, String barcode, List<String> visibleKeys) {}

    @PostMapping("/scan")
    synchronized PackingScans.Result scan(HttpServletRequest request, @RequestBody ScanRequest body) {
        var actor = session(request);
        if (!actor.terminal().equals(body.terminalId()) || !actor.operator().equals(body.operatorId()))
            throw fail(403, "SCAN_SESSION_CHANGED");
        if (body.visibleKeys() == null || body.visibleKeys().stream().anyMatch(Objects::isNull))
            throw fail(422, "INVALID_PACKING_ROW");
        if (settings.pinnedWarehouseRoles(request).filter(roles -> roles.getOrDefault("good",List.of()).isEmpty()).isPresent())
            throw fail(409, "GOOD_WAREHOUSE_REQUIRED");
        synchronized (domain) {
            return scans.resolve(body.barcode(), body.visibleKeys(), rows(actor, materials(actor,request)),
                    key -> stock(key,request));
        }
    }

    @GetMapping("/stock")
    synchronized List<PackingStock.Candidate> stock(@RequestParam String key, HttpServletRequest request) {
        var actor = session(request);
        var seed = DrawingController.packingOrders(actor).stream()
                .filter(row -> DrawingController.format(row.key()).equals(key)).findFirst().orElseThrow(() -> fail(403,"OUT_OF_SCOPE"));
        return stock.candidates(seed, orders.get(seed.item()), domain.inventory(actor,seed.key()));
    }

    private List<String> materials(Session actor, HttpServletRequest request) {
        var config = settings.read(actor.terminal(),request).getBody();
        return config.view().applied().values().materials();
    }

    private List<Row> rows(Session actor, List<String> allowed) {
        return DrawingController.packingOrders(actor).stream().map(seed -> {
            var state = domain.get(actor, seed.key()).value();
            var available = domain.inventory(actor,seed.key()).getOrDefault(seed.cutStock(),BigDecimal.ZERO);
            var saved = completed.getOrDefault(seed.key(),List.of());
            if (saved.isEmpty() && state.shipment() != null) saved = List.of(new Piece(seed.cutStock().lot(),state.shipment().quantity(),null,null,seed.item()));
            var records = domain.audit(actor, seed.key()).records();
            String started = null, finished = null;
            for (var record : records) {
                if (record.action() == Action.STANDARD_PACK_CANCEL) { started = null; finished = null; }
                if (record.action() == Action.STANDARD_PACK_START) started = record.recordedAt().toString();
                if (record.action() == Action.STANDARD_PACK_FINISH) finished = record.recordedAt().toString();
            }
            return new Row(DrawingController.format(seed.key()),orders.get(seed.item()),seed.orderQuantity(),
                    seed.cutStock().lot(),available,state.state(),state.version(),state.ownerTerminal(),allowed.contains(orders.get(seed.item()).materialCode),started,finished,saved);
        }).toList();
    }

    @PostMapping("/commands")
    synchronized Result command(HttpServletRequest request, @RequestBody Request body) {
        var actor = session(request);
        if (!actor.operator().equals(body.operatorId)) throw fail(403, "OPERATOR_MISMATCH");
        if (body.requestId == null || body.action == null || !ACTIONS.contains(body.action)
                || body.members == null || body.members.isEmpty()) throw fail(422, "INVALID_COMMAND");
        var ticket = new Ticket(actor.terminal(),body.requestId);
        var prior = receipts.get(ticket);
        if (prior != null) {
            if (!prior.operator.equals(actor.operator())) throw fail(403, "OTHER_OPERATOR");
            if (!prior.body.equals(body)) throw fail(409, "REQUEST_ID_REUSED");
            return prior.result;
        }
        var scoped = DrawingController.packingOrders(actor).stream()
                .collect(Collectors.toMap(seed -> DrawingController.format(seed.key()), seed -> seed));
        var allowed = materials(actor,request);
        synchronized (domain) {
            return commit(actor, request, body, ticket, scoped, allowed);
        }
    }

    private Result commit(Session actor, HttpServletRequest request, Request body, Ticket ticket,
                          Map<String,Seed> scoped, List<String> allowed) {
        var commands = new LinkedHashMap<PlanKey,Command>();
        var pieces = new LinkedHashMap<PlanKey,List<Piece>>();
        boolean finish = body.action == Action.STANDARD_PACK_FINISH;
        for (var member : body.members) {
            if (member == null || member.key == null || member.version == null || member.version < 0) throw fail(422,"INVALID_MEMBER");
            var seed = scoped.get(member.key);
            if (seed == null) throw fail(403,"OUT_OF_SCOPE");
            if (body.action == Action.STANDARD_PACK_START && !allowed.contains(orders.get(seed.item()).materialCode)) throw fail(422,"MATERIAL_NOT_ASSIGNED");
            if (commands.containsKey(seed.key())) throw fail(422,"DUPLICATE_MEMBER");
            if (domain.get(actor, seed.key()).value().version() != member.version) throw fail(409, "STALE_VERSION");
            BigDecimal total = null;
            if (finish) {
                if (member.pieces == null || member.pieces.isEmpty()) throw fail(422,"NO_PACKING_ROWS");
                total = BigDecimal.ZERO;
                var candidates = stock.candidates(seed, orders.get(seed.item()), domain.inventory(actor,seed.key()));
                var used = new HashMap<PackingStock.Candidate,BigDecimal>();
                var resolved = new ArrayList<Piece>();
                for (var piece : member.pieces) {
                    if (piece == null || !seed.cutStock().lot().equals(piece.lot) || piece.qty == null
                            || piece.qty.compareTo(BigDecimal.ONE) < 0) throw fail(422, "INVALID_PACKING_ROW");
                    var matches = candidates.stream().filter(candidate -> candidate.lot().equals(piece.lot)
                            && (piece.item == null || candidate.item().equals(piece.item))
                            && (piece.warehouse == null || candidate.warehouse().equals(piece.warehouse))
                            && (piece.location == null || candidate.location().equals(piece.location))).toList();
                    if (matches.size() != 1) throw fail(422,"INVALID_PACKING_STOCK");
                    var candidate = matches.get(0);
                    if (used.merge(candidate,piece.qty,BigDecimal::add).compareTo(candidate.qty()) > 0) throw fail(422,"PACK_QTY_EXCEEDED");
                    resolved.add(new Piece(candidate.lot(),piece.qty,candidate.warehouse(),candidate.location(),candidate.item()));
                    total = total.add(piece.qty);
                }
                pieces.put(seed.key(),List.copyOf(resolved));
            }
            commands.put(seed.key(),new Command(body.action, member.version,"packing/"+actor.operator()+"/"+body.requestId,
                    finish ? seed.cutStock() : null,total,null,List.of()));
        }
        var labels = new ArrayList<Label>();
        boolean print = finish && body.autoLabel && !"000001".equals(actor.site());
        String device = null;
        if (print) {
            var config = settings.read(actor.terminal(),request).getBody();
            if (config != null && config.view() != null) device = config.view().applied().values().outputs().get("label");
        }
        var result = domain.packBatch(actor, commands);
        if (result.status() != 200) throw fail(result.status(),result.error());
        var completedGroups = new LinkedHashSet<String>();
        for (var key : commands.keySet()) {
            if (body.action == Action.STANDARD_PACK_START) groups.put(key,"PACK-"+key.sequence()+"-"+body.requestId);
            if (body.action == Action.STANDARD_PACK_CANCEL) groups.remove(key);
            if (finish) {
                completed.put(key,pieces.get(key));
                completedGroups.add(groups.getOrDefault(key,"PACK-"+DrawingController.format(key)));
                for (int i = 1; i < pieces.get(key).size(); i++) completedGroups.add("PACK-"+body.requestId+"-"+key.sequence()+"-"+i);
            }
        }
        if (print) for (var group : completedGroups) {
            boolean configured = device != null && !device.equals("NONE");
            labels.add(new Label(group,"Printer3",configured ? device : null,configured ? "SIMULATED_DIRECT" : "UNCONFIGURED"));
        }
        var response = new Result(rows(actor,allowed),List.copyOf(labels));
        receipts.put(ticket,new Receipt(actor.operator(),body,response));
        return response;
    }
}
