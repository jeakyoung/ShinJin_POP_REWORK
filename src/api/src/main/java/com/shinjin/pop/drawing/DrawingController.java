package com.shinjin.pop.drawing;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.drawing.DrawingDomain.*;
import synthetic.drawing.InMemoryDrawingDomain;
import synthetic.drawing.InMemoryDrawingDomain.GroupAction;
import synthetic.drawing.InMemoryDrawingDomain.GroupCommand;
import synthetic.drawing.InMemoryDrawingDomain.GroupLine;
import synthetic.drawing.InMemoryDrawingDomain.GroupResult;
import synthetic.drawing.InMemoryDrawingDomain.GroupSeed;
import synthetic.drawing.InMemoryDrawingDomain.GroupView;
import synthetic.drawing.InMemoryDrawingDomain.SharedLot;

@Profile("demo")
@RestController
@RequestMapping("/api/drawing-008")
public class DrawingController {
    private static final LocalDate DATE = LocalDate.of(2026, 11, 25);
    private static final DateTimeFormatter DATE_KEY = DateTimeFormatter.BASIC_ISO_DATE;
    private static final Map<String, Bin> BINS = Map.of(
            "011", Bin.CUT, "018", Bin.DRAWING, "010", Bin.REMNANT,
            "017", Bin.PRODUCT, "016", Bin.SHIPPING, "012", Bin.MANUAL);
    private static final List<Seed> SEEDS = List.of(
            seed("F1", "000001", 1, OrderType.DRAWING, "A", true),
            seed("F1", "000001", 2, OrderType.DRAWING_DEFERRED, "B", true),
            seed("F1", "000001", 3, OrderType.OTHER, "C", true),
            seed("F1", "000001", 4, OrderType.DRAWING, "D", false),
            seed("F1", "000001", 5, OrderType.DRAWING, "G1", false),
            seed("F1", "000001", 6, OrderType.DRAWING, "G2", false),
            seed("F1", "000001", 7, OrderType.DRAWING, "G3", false),
            seed("F1", "000001", 8, OrderType.DRAWING, "G4", false),
            seed("F1", "000001", 9, OrderType.STANDARD_PACK, "STD", false),
            seed("F1", "000001", 10, OrderType.DRAWING, "M1", false),
            mixedSeed(11, "M2"),
            seed("F1", "000001", 12, OrderType.DRAWING, "M3", false),
            mixedSeed(13, "M4"),
            seed("F2", "000002", 1, OrderType.DRAWING, "E", true),
            seed("F2", "000002", 9, OrderType.STANDARD_PACK, "STD-B", false),
            seed("F2", "000002", 14, OrderType.STANDARD_PACK, "STD-C", false),
            seed("F2", "000002", 15, OrderType.STANDARD_PACK, "STD-S1", false));

    private static final List<GroupSeed> GROUPS = List.of(
            new GroupSeed("PG-008-A", List.of(groupKey(5), groupKey(6))),
            new GroupSeed("PG-008-B", List.of(groupKey(7), groupKey(8))),
            new GroupSeed("PG-008-MIX-A", List.of(groupKey(10), groupKey(11))),
            new GroupSeed("PG-008-MIX-B", List.of(groupKey(12), groupKey(13))));
    private static final List<SharedLot> SHARED_LOTS = List.of(
            new SharedLot("F1", "000001", new StockKey("SHARED-008", Bin.MANUAL, "ITEM-SHARED"), BigDecimal.valueOf(6)),
            new SharedLot("F1", "000001", new StockKey("SHARED-008", Bin.DRAWING, "ITEM-SHARED"), BigDecimal.valueOf(5)),
            new SharedLot("F1", "000001", remnant("REM-AUTO-A"), BigDecimal.ONE),
            new SharedLot("F1", "000001", remnant("REM-AUTO-B"), new BigDecimal("0.500")));

    private final InMemoryDrawingDomain domain;
    private final DrawingReturnPlaces returnPlaces;
    private final DrawingGoodPlaces goodPlaces;
    private final com.shinjin.pop.admin.TerminalSettingsDemoController terminalSettings;

    private final Map<String, DisplayFields> display;
    private final List<StockFields> stockFields;
    private final Map<PlanKey,Seed> listedSeeds = new java.util.concurrent.ConcurrentHashMap<>();

    DrawingController(InMemoryDrawingDomain domain, DrawingReturnPlaces returnPlaces, DrawingGoodPlaces goodPlaces,
            com.shinjin.pop.admin.TerminalSettingsDemoController terminalSettings,
            @org.springframework.beans.factory.annotation.Value("${shinjin.demo.drawing-screen:classpath:demo/drawing-screen.json}")
            org.springframework.core.io.Resource dataset,
            @org.springframework.beans.factory.annotation.Value("${shinjin.demo.drawing-stock:classpath:demo/drawing-stock.json}")
            org.springframework.core.io.Resource stockDataset) throws java.io.IOException {
        this.domain = domain;
        this.returnPlaces = returnPlaces;
        this.goodPlaces = goodPlaces;
        this.terminalSettings = terminalSettings;
        try (var input = stockDataset.getInputStream()) {
            stockFields = tools.jackson.databind.json.JsonMapper.builder().build().readValue(input,
                    new tools.jackson.core.type.TypeReference<List<StockFields>>() {});
        }
        SEEDS.forEach(seed -> listedSeeds.put(seed.key(),seed));
        try (var input = dataset.getInputStream()) {
            display = new java.util.concurrent.ConcurrentHashMap<>(tools.jackson.databind.json.JsonMapper.builder().build().readValue(input,
                    new tools.jackson.core.type.TypeReference<Map<String, DisplayFields>>() {}));
        }
    }

    @Bean
    static InMemoryDrawingDomain drawingDomain() {
        return new InMemoryDrawingDomain(
                Clock.fixed(Instant.parse("2026-11-25T01:00:00Z"), ZoneOffset.UTC), SEEDS, GROUPS, SHARED_LOTS);
    }

    static List<Seed> packingOrders(Session session) {
        return SEEDS.stream().filter(seed -> seed.type() == OrderType.STANDARD_PACK && sameSite(session, seed.key())).toList();
    }

    static List<PlanKey> scopedPlanKeys(Session session) {
        return SEEDS.stream().map(Seed::key).filter(key -> sameSite(session, key)).toList();
    }

    record DisplayFields(String orderNumber, int orderSequence, String customer, String material, String kind,
                         LocalDate dueDate, BigDecimal thickness, BigDecimal width, BigDecimal length,
                         String returnWarehouse, String returnLocation, String qualityCode) {
        String returnMaterial() {
            return "014".equals(qualityCode) || "015".equals(qualityCode) ? "S45C" : material;
        }
    }
    record StockFields(String factory, String site, String lot, String warehouse, String item, String location,
                       BigDecimal thickness, BigDecimal width, BigDecimal length) {}
    record StockView(String lot, String warehouse, String item, String location, BigDecimal thickness, BigDecimal width,
                     BigDecimal length, BigDecimal available) {}
    private List<StockView> stockViews(Session actor, PlanKey key, List<Input> inputs) {
        var balances = domain.inputBalances(actor, key);
        return inputs.stream().map(input -> {
            var row = material(input.stock(), input.quantity());
            var label = stockFields.stream().filter(info -> info.factory().equals(key.factory())
                    && info.site().equals(key.site()) && info.lot().equals(row.lot())
                    && java.util.Objects.equals(info.location(), row.location()) && info.warehouse().equals(row.warehouse()) && info.item().equals(row.item())).findFirst();
            return new StockView(row.lot(), row.warehouse(), row.item(), row.location(), label.map(StockFields::thickness).orElse(null),
                    label.map(StockFields::width).orElse(null), label.map(StockFields::length).orElse(null),
                    balances.getOrDefault(input.stock(), BigDecimal.ZERO));
        }).toList();
    }
    record PlanOption(String key, String fgUse2, String item, String cutLot, BigDecimal orderQuantity, DisplayFields display,
                      DrawingGoodPlaces.Options goodPlaces) {}
    record Material(String lot, String warehouse, String item, BigDecimal qty, String location) {
        Material(String lot, String warehouse, String item, BigDecimal qty) { this(lot, warehouse, item, qty, null); }
        StockKey stock() { return new StockKey(lot, warehouse == null ? null : BINS.get(warehouse), item, location); }
    }
    record ShipmentView(String id, Material material, boolean deferred, String startedAt, String finishedAt) {}
    record PlanView(State state, String plateFlag, long version, String ownerTerminalId,
                    boolean bypassedPack1, String shipPlanId, ShipmentView shipment, String activeGroupId, String productionGroupNo,GoodPlace goodPlace) {}
    record ScanBody(Decision decision) {}
    record ScanView(boolean accepted, String scanToken, List<Material> materials, List<StockView> stockDetails) {}
    record CommandBody(Action action, Long expectedVersion, String requestId, String lot, BigDecimal qty,
                       BigDecimal goodQty, String scanToken, List<Material> inputs, List<MaterialReturn> returns,DrawingGoodPlaces.Codes goodPlace) {}

    record GroupCandidateView(Material material, List<String> eligiblePlans) {}
    record GroupMemberView(String key, PlanView snapshot, GroupResult result, List<Material> drawingInputs, Material autoRemnant) {}
    record GroupResponse(String id, List<GroupMemberView> members, List<GroupCandidateView> candidates) {}
    record GroupBody(GroupAction action, String requestId, List<GroupMemberBody> members) {}
    record GroupMemberBody(String key, Long expectedVersion, List<Material> inputs, BigDecimal goodQty, Boolean confirmSkip) {}

    @Bean
    static WebServerFactoryCustomizer<TomcatServletWebServerFactory> drawingKeys() {
        return factory -> factory.addConnectorCustomizers(connector -> connector.setEncodedSolidusHandling("passthrough"));
    }

    synchronized void registerPlanned(PlanKey key, String item, BigDecimal quantity, DisplayFields fields) {
        if (listedSeeds.containsKey(key)) return;
        var seed = new Seed(key,OrderType.DRAWING,item,quantity,new StockKey("",Bin.CUT,item),null,Map.of());
        domain.registerInstruction(seed);
        display.put(format(key),fields);
        listedSeeds.put(key,seed);
    }

    static List<Seed> planningSeeds() { return SEEDS; }
    DisplayFields fields(PlanKey key) { return display.get(format(key)); }

    @GetMapping("/plans")
    List<PlanOption> plans(HttpServletRequest request) {
        var session = session(request);
        return listedSeeds.values().stream().filter(seed -> sameSite(session,seed.key()))
                .sorted(java.util.Comparator.comparing((Seed seed) -> seed.key().date()).thenComparingInt(seed -> seed.key().sequence()))
                .map(seed -> option(seed,goodPlaces.options(session,seed.key(),request))).toList();
    }

    @GetMapping("/return-places")
    List<DrawingReturnPlaces.Warehouse> returnPlaces(HttpServletRequest request) {
        return returnPlaces.choices(session(request), request);
    }

    @PostMapping("/good-place")
    ResponseEntity<?> selectGood(HttpServletRequest request,@RequestBody DrawingGoodPlaces.Selection selection) {
        var actor = session(request);
        var key = selection.key()==null ? null : parse(selection.key());
        if (key==null) return error(422,"INVALID_PLAN_KEY");
        var result = domain.get(actor,key);
        if (result.status()!=200) return error(result.status(),result.error());
        var row=result.value();
        if (row.ownerTerminal()!=null && !row.ownerTerminal().equals(actor.terminal())) return error(403,"TERMINAL_MISMATCH");
        if (!(row.state()==State.CUT_READY || row.state()==State.DRAW_READY || row.state()==State.DRAW_ACTIVE || row.state()==State.DRAW_PAUSED))
            return error(409,"INVALID_STATE");
        return ResponseEntity.ok(goodPlaces.select(actor,key,row,selection,request));
    }

    private GoodPlace good(Session actor,PlanKey key,DrawingGoodPlaces.Codes codes,HttpServletRequest request) {
        if(codes==null) return null;
        var result=domain.get(actor,key);
        if(result.status()!=200) throw new ResponseStatusException(HttpStatus.valueOf(result.status()),result.error());
        return goodPlaces.resolve(actor,key,result.value(),codes,request);
    }

    record ReturnSpec(String key, String inputItem, MaterialReturn row) {}
    @PostMapping("/return-material")
    ResponseEntity<?> returnMaterial(HttpServletRequest request, @RequestBody ReturnSpec spec) {
        var actor = session(request);
        var key = spec.key() == null ? null : parse(spec.key());
        var row = spec.row();
        if (key == null || row == null || row.thickness() == null || row.width() == null || row.length() == null)
            return error(422, "INVALID_MATERIAL_RETURN");
        var state = domain.get(actor, key);
        if (state.status() != 200) return error(state.status(), state.error());
        if (!DrawingReturnPlaces.contains(returnPlaces.choices(actor, request), row.warehouse(), row.location()))
            return error(422, "INVALID_RETURN_DESTINATION");
        var info = fields(key);
        String result = info == null ? "" : returnPlaces.lookup(actor, info.material(), row.warehouse(), spec.inputItem(), row);
        return ResponseEntity.ok(Map.of("material", result));
    }

    private boolean validDestinations(List<MaterialReturn> lines,List<DisplayFields> permitted,HttpServletRequest request) {
        if (lines.isEmpty()) return true;
        var actor = session(request);
        var choices = returnPlaces.choices(actor, request);
        return lines.stream().allMatch(line -> line != null && DrawingReturnPlaces.contains(choices,line.warehouse(),line.location())
                && permitted.stream().anyMatch(row ->
                    (java.util.Objects.equals(row.returnWarehouse(),line.warehouse()) && java.util.Objects.equals(row.returnLocation(),line.location())
                        && java.util.Objects.equals(row.returnMaterial(),line.material()))
                    || returnPlaces.matchesResolvedMaterial(actor,row.material(),line)));
    }

    record ReturnEdit(String key, Long expectedVersion, String requestId, List<MaterialReturn> returns) {}
    @PostMapping("/returns")
    ResponseEntity<?> saveReturns(HttpServletRequest request,@RequestBody ReturnEdit edit) {
        var actor = session(request);
        var key = edit.key() == null ? null : parse(edit.key());
        if (key == null || edit.expectedVersion() == null || edit.returns() == null) return error(422,"INVALID_MATERIAL_RETURN");
        var state = domain.get(actor,key);
        if (state.status()!=200) return error(state.status(),state.error());
        List<DisplayFields> permitted;
        if (state.value().activeGroupId() == null) permitted = java.util.stream.Stream.of(fields(key)).filter(java.util.Objects::nonNull).toList();
        else {
            var group = domain.group(actor,state.value().activeGroupId());
            if (group.status()!=200) return error(group.status(),group.error());
            permitted = group.value().members().stream().map(member -> fields(member.key())).filter(java.util.Objects::nonNull).toList();
        }
        if (!validDestinations(edit.returns(),permitted,request)) return error(422,"INVALID_RETURN_DESTINATION");
        var result = domain.saveReturns(actor,key,edit.expectedVersion(),edit.requestId(),edit.returns());
        return result.status()==200 ? ResponseEntity.ok(view(result.value())) : error(result.status(),result.error());
    }

    record DeleteRow(String key, Long expectedVersion) {}
    record DeleteList(String requestId, List<DeleteRow> rows) {}
    @PostMapping("/delete-listed")
    ResponseEntity<?> deleteListed(HttpServletRequest request,@RequestBody DeleteList input) {
        var actor = session(request);
        if (input.rows() == null || input.rows().stream().anyMatch(row -> row == null || row.key() == null || row.expectedVersion() == null))
            return error(422,"INVALID_LIST");
        var rows = input.rows().stream().map(row -> new InMemoryDrawingDomain.DeleteLine(parse(row.key()),row.expectedVersion())).toList();
        var result = domain.deleteListed(actor,input.requestId(),rows);
        return result.status() == 200 ? ResponseEntity.ok(Map.of("deleted",true)) : error(result.status(),result.error());
    }

    @GetMapping("/groups")
    List<String> groups(HttpServletRequest request) {
        return domain.groups(session(request));
    }

    record GridMember(String key,Long expectedVersion,String scanToken,List<Material> inputs,BigDecimal goodQty,DrawingGoodPlaces.Codes goodPlace) {}
    record GridCommand(String groupId,GroupAction action,String requestId,List<GridMember> members,List<MaterialReturn> returns) {}
    @PostMapping("/work-grid/commands")
    ResponseEntity<?> gridCommand(HttpServletRequest request,@RequestBody GridCommand body) {
        var actor=session(request);
        if(body.members()==null || body.members().stream().anyMatch(row->row==null || row.key()==null ||
                row.expectedVersion()==null || row.expectedVersion()<0)) return error(422,"INVALID_GROUP_MEMBERS");
        if(body.action()==GroupAction.DRAW_START && body.groupId()==null) {
            var rows=body.members().stream().map(row->new InMemoryDrawingDomain.ScannedMember(parse(row.key()),
                    row.expectedVersion(),row.scanToken(),inputs(row.inputs()),good(actor,parse(row.key()),row.goodPlace(),request))).toList();
            if(rows.stream().anyMatch(row->row.inputs().stream().anyMatch(input->input.stock()==null || input.quantity()==null)))
                return error(422,"INVALID_INPUT");
            var returns=body.returns()==null ? List.<MaterialReturn>of() : body.returns();
            var fields=rows.stream().map(row->fields(row.key())).filter(java.util.Objects::nonNull).toList();
            if (!validDestinations(returns,fields,request)) return error(422,"INVALID_RETURN_DESTINATION");
            return groupResponse(domain.startScannedGroup(actor,body.requestId(),rows,returns));
        }
        if(body.groupId()==null || body.action()==GroupAction.DRAW_START || body.action()==null)return error(422,"INVALID_GROUP_MEMBERS");
        var lines=body.members().stream().map(row->new GroupLine(parse(row.key()),row.expectedVersion(),List.of(),row.goodQty(),false,
                good(actor,parse(row.key()),row.goodPlace(),request))).toList();
        return groupResponse(domain.executeGroup(actor,body.groupId(),new GroupCommand(body.action(),body.requestId(),lines)));
    }

    @GetMapping("/groups/{id}")
    ResponseEntity<?> group(HttpServletRequest request, @PathVariable String id) {
        return groupResponse(domain.group(session(request), id));
    }

    @PostMapping("/groups/{id}/commands")
    ResponseEntity<?> groupCommand(HttpServletRequest request, @PathVariable String id, @RequestBody GroupBody body) {
        var identity = session(request);
        var access = domain.group(identity, id);
        if (access.status() != 200) return error(access.status(), access.error());
        if (body.members() == null || body.members().stream().anyMatch(member -> member == null
                || member.key() == null || member.expectedVersion() == null || member.expectedVersion() < 0)) {
            return error(422, "INVALID_GROUP_MEMBERS");
        }
        var lines = body.members().stream().map(member -> new GroupLine(parse(member.key()), member.expectedVersion(),
                inputs(member.inputs()), member.goodQty(), Boolean.TRUE.equals(member.confirmSkip()))).toList();
        return groupResponse(domain.executeGroup(identity, id, new GroupCommand(body.action(), body.requestId(), lines)));
    }

    private static ResponseEntity<?> groupResponse(Reply<GroupView> result) {
        if (result.status() != 200) return error(result.status(), result.error());
        var group = result.value();
        return ResponseEntity.ok(new GroupResponse(group.id(),
                group.members().stream().map(member -> new GroupMemberView(format(member.key()), view(member.snapshot()), member.result(),
                        materials(member.drawingInputs()), member.autoRemnant() == null ? null :
                                material(member.autoRemnant().stock(), member.autoRemnant().quantity()))).toList(),
                group.candidates().stream().map(candidate -> new GroupCandidateView(
                        material(candidate.stock(), candidate.available()),
                        candidate.eligiblePlans().stream().map(DrawingController::format).toList())).toList()));
    }

    @GetMapping("/material-scan")
    ResponseEntity<?> materialScan(HttpServletRequest request, @org.springframework.web.bind.annotation.RequestParam String plan,
            @org.springframework.web.bind.annotation.RequestParam(required=false) String lot) {
        var actor = session(request);
        var key = parse(plan);
        if (key == null) return error(400, "INVALID_PLAN_KEY");
        var detail = domain.get(actor, key);
        if (detail.status() != 200) return error(detail.status(), detail.error());
        var scoped = stockFields.stream().filter(s -> s.factory().equals(key.factory()) && s.site().equals(key.site())).toList();
        var warehouses = terminalSettings.pinnedWarehouseRoles(request).map(roles -> roles.getOrDefault("issue", List.of()))
                .orElseGet(() -> scoped.stream().map(StockFields::warehouse).distinct().toList());
        var spec = display.get(plan);
        if (lot == null) {
            var places = warehouses.stream().map(code -> Map.of("code", code, "name", code)).toList();
            return ResponseEntity.ok(Map.of("issue", places, "auxiliary", List.of(), "initial", "",
                    "quality", spec == null ? "" : spec.material(), "thickness", spec == null ? "" : spec.thickness().toString(),
                    "width", spec == null ? "" : spec.width().toString()));
        }
        var balances = domain.inputBalances(actor, key);
        var seed = listedSeeds.get(key);
        var rows = scoped.stream().filter(s -> seed != null && s.item().equals(seed.item()) && warehouses.contains(s.warehouse())
                && s.lot().equals(lot)).map(s -> {
            var available = balances.getOrDefault(new StockKey(s.lot(), BINS.get(s.warehouse()), s.item(), s.location()), BigDecimal.ZERO);
            return new ScanStock(s.warehouse(), s.location() == null ? "" : s.location(), s.lot(), s.item(),
                    s.thickness(), s.width(), s.length(), available, spec == null ? "" : spec.material());
        }).filter(row -> row.available().signum() > 0).toList();
        return ResponseEntity.ok(rows);
    }

    record ScanStock(String warehouse, String location, String lot, String material, BigDecimal thickness,
                     BigDecimal width, BigDecimal length, BigDecimal available, String quality) {}

    @GetMapping("/active")
    List<String> active(HttpServletRequest request) {
        return domain.active(session(request)).stream().map(DrawingController::format).toList();
    }

    @GetMapping("/plans/{*path}")
    ResponseEntity<?> get(HttpServletRequest request) {
        var session = session(request);
        var path = path(request);
        boolean audit = path.endsWith("/audit");
        var key = parse(audit ? path.substring(0, path.length() - 6) : path);
        if (key == null) return error(400, "INVALID_PLAN_KEY");
        var result = domain.get(session, key);
        if (result.status() != 200) return error(result.status(), result.error());
        if (audit) {
            var details = domain.audit(session, key);
            return ResponseEntity.ok(Map.of("inventory", details.inventory().entrySet().stream()
                    .map(entry -> material(entry.getKey(), entry.getValue())).toList(),
                    "stockDetails", stockViews(session, key, details.drawingInputs()),
                    "records", details.records(), "drawingInputs", materials(details.drawingInputs()), "returns", details.returns(), "goodQuantity",details.goodQuantity(),
                    "productReceipts",details.productReceipts().stream().map(row->Map.of("material",material(row.stock(),row.quantity()),"location",row.location())).toList()));
        }
        return ResponseEntity.ok(view(result.value()));
    }

    @PostMapping({"/plans/{key}/scan", "/plans/{factory}/{site}/{date}/{seq}/scan"})
    ResponseEntity<?> scan(HttpServletRequest request, @RequestBody ScanBody body) {
        var session = session(request);
        var path = path(request);
        var key = parse(path.substring(0, path.length() - 5));
        if (key == null) return error(400, "INVALID_PLAN_KEY");
        var result = domain.scan(session, key, body.decision());
        if (result.status() != 200) return error(result.status(), result.error());
        var scan = result.value();
        return ResponseEntity.ok(new ScanView(scan.accepted(), scan.token(), materials(scan.materials()), stockViews(session, key, scan.materials())));
    }

    @PostMapping({"/plans/{key}/commands", "/plans/{factory}/{site}/{date}/{seq}/commands"})
    ResponseEntity<?> execute(HttpServletRequest request, @RequestBody CommandBody body) {
        var session = session(request);
        var path = path(request);
        var key = parse(path.substring(0, path.length() - 9));
        if (key == null) return error(400, "INVALID_PLAN_KEY");
        var scope = domain.get(session, key);
        if (scope.status() != 200) return error(scope.status(), scope.error());
        if (body.action() == Action.STANDARD_PACK_CANCEL) return error(422, "USE_PACKING_COMMAND");
        if (body.expectedVersion() == null || body.expectedVersion() < 0) return error(422, "VERSION_REQUIRED");
        var seed = listedSeeds.get(key);
        var stock = body.lot() == null
                ? (body.action() == Action.STANDARD_PACK_FINISH ? seed.cutStock() : null)
                : new StockKey(body.lot(), Bin.CUT, seed.item());
        var inputs = inputs(body.inputs());
        var row = display.get(format(key));
        if (body.returns() != null && !validDestinations(body.returns(),row == null ? List.of() : List.of(row),request))
            return error(422, "INVALID_RETURN_DESTINATION");
        var amount = body.action() == Action.DRAW_FINISH ? body.goodQty() : body.qty();
        var result = domain.execute(session, key, new Command(body.action(), body.expectedVersion(),
                body.requestId(), stock, amount, body.scanToken(), inputs, body.returns(),goodPlaces.resolve(session,key,scope.value(),body.goodPlace(),request)));
        return result.status() == 200 ? ResponseEntity.ok(view(result.value())) : error(result.status(), result.error());
    }

    private static List<Material> materials(List<Input> inputs) {
        return inputs.stream().map(input -> material(input.stock(), input.quantity())).toList();
    }

    private static List<Input> inputs(List<Material> materials) {
        return materials == null ? List.of() : materials.stream()
                .map(item -> item == null ? new Input(null, null) : new Input(item.stock(), item.qty())).toList();
    }

    private static PlanView view(Snapshot snapshot) {
        var shipment = snapshot.shipment();
        return new PlanView(snapshot.state(), snapshot.plateFlag(), snapshot.version(), snapshot.ownerTerminal(),
                snapshot.bypassedPack1(), shipment == null ? null : shipment.id(),
                shipment == null ? null : new ShipmentView(shipment.id(), material(shipment.stock(), shipment.quantity()),
                        shipment.deferred(), shipment.startedAt().toString(), shipment.finishedAt().toString()), snapshot.activeGroupId(), snapshot.productionGroupNo(),snapshot.goodPlace());
    }

    private static Material material(StockKey stock, BigDecimal quantity) {
        return new Material(stock.lot(), BINS.entrySet().stream().filter(entry -> entry.getValue() == stock.bin())
                .findFirst().orElseThrow().getKey(), stock.item(), quantity, stock.location());
    }

    static Session session(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        String terminal = identity.terminal() == null ? null : identity.terminal().id();
        String worker = identity.worker() == null ? null : identity.worker().id();
        if (terminal == null || terminal.isBlank() || worker == null || worker.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid drawing demo identity");
        }
        return switch (terminal) {
            case "DEMO-A", "DEMO-A2" -> new Session("F1", "000001", terminal, worker);
            case "DEMO-B" -> new Session("F2", "000002", terminal, worker);
            default -> throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN, "Drawing demo terminal unavailable");
        };
    }

    private static boolean sameSite(Session session, PlanKey key) {
        return session.factory().equals(key.factory()) && session.site().equals(key.site());
    }

    private static PlanKey groupKey(int sequence) {
        return new PlanKey("F1", "000001", DATE, sequence);
    }

    private static Seed seed(String factory, String site, int sequence, OrderType type, String code, boolean hasRemnant) {
        var item = "ITEM-" + code;
        var cut = new StockKey("CUT-" + code, Bin.CUT, item);
        var remnant = new StockKey("REM-" + code, Bin.REMNANT, item);
        var stock = new java.util.HashMap<StockKey, BigDecimal>();
        stock.put(cut, BigDecimal.valueOf(4));
        if (factory.equals("F1") && code.equals("A")) {
            stock.put(new StockKey("SCAN-008", Bin.MANUAL, item, "DEMO-L1"), BigDecimal.valueOf(2));
            stock.put(new StockKey("SCAN-008", Bin.MANUAL, item, "DEMO-L2"), BigDecimal.ONE);
        }
        if (hasRemnant) stock.put(remnant, BigDecimal.valueOf(2));
        return new Seed(new PlanKey(factory, site, DATE, sequence), type, item, BigDecimal.valueOf(4), cut, remnant, stock);
    }

    private static StockKey remnant(String lot) {
        return new StockKey(lot, Bin.REMNANT, "ITEM-REM-SAME-GRADE");
    }

    private static Seed mixedSeed(int sequence, String code) {
        var plan = seed("F1", "000001", sequence, OrderType.DRAWING, code, false);
        return new Seed(plan.key(), plan.type(), plan.item(), plan.orderQuantity(), plan.cutStock(),
                remnant("REM-AUTO-A"), plan.stock());
    }

    private PlanOption option(Seed seed,DrawingGoodPlaces.Options options) {
        String type = switch (seed.type()) {
            case DRAWING -> "002";
            case DRAWING_DEFERRED -> "003";
            case STANDARD_PACK -> "PACK";
            case OTHER -> "001";
        };
        return new PlanOption(format(seed.key()), type, seed.item(), seed.cutStock().lot(), seed.orderQuantity(), display.get(format(seed.key())),options);
    }

    private static String path(HttpServletRequest request) {
        String prefix = request.getContextPath() + "/api/drawing-008/plans/";
        return URLDecoder.decode(request.getRequestURI().substring(prefix.length()), StandardCharsets.UTF_8);
    }

    private static PlanKey parse(String path) {
        var pieces = path.split("/", -1);
        if (pieces.length != 4 || !pieces[0].matches("F[0-9]+") || !pieces[1].matches("[0-9]{6}")
                || !pieces[2].matches("[0-9]{8}") || !pieces[3].matches("[1-9][0-9]{0,8}")) return null;
        try {
            return new PlanKey(pieces[0], pieces[1], LocalDate.parse(pieces[2], DATE_KEY), Integer.parseInt(pieces[3]));
        } catch (java.time.DateTimeException error) {
            return null;
        }
    }

    static String format(PlanKey key) {
        return String.join("/", key.factory(), key.site(), key.date().format(DATE_KEY), Integer.toString(key.sequence()));
    }

    private static ResponseEntity<Map<String, String>> error(int status, String code) {
        return ResponseEntity.status(status).body(Map.of("error", code));
    }
}
