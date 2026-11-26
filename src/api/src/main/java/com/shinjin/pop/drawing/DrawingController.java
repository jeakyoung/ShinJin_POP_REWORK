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
            seed("F2", "000002", 1, OrderType.DRAWING, "E", true));

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

    DrawingController(InMemoryDrawingDomain domain) {
        this.domain = domain;
    }

    @Bean
    static InMemoryDrawingDomain drawingDomain() {
        return new InMemoryDrawingDomain(
                Clock.fixed(Instant.parse("2026-11-25T01:00:00Z"), ZoneOffset.UTC), SEEDS, GROUPS, SHARED_LOTS);
    }

    static List<PlanKey> scopedPlanKeys(Session session) {
        return SEEDS.stream().map(Seed::key).filter(key -> sameSite(session, key)).toList();
    }

    record PlanOption(String key, String fgUse2, String item, String cutLot, BigDecimal orderQuantity) {}
    record Material(String lot, String warehouse, String item, BigDecimal qty) {
        StockKey stock() { return new StockKey(lot, warehouse == null ? null : BINS.get(warehouse), item); }
    }
    record ShipmentView(String id, Material material, boolean deferred, String startedAt, String finishedAt) {}
    record PlanView(State state, String plateFlag, long version, String ownerTerminalId,
                    boolean bypassedPack1, String shipPlanId, ShipmentView shipment, String activeGroupId) {}
    record ScanBody(Decision decision) {}
    record ScanView(boolean accepted, String scanToken, List<Material> materials) {}
    record CommandBody(Action action, Long expectedVersion, String requestId, String lot, BigDecimal qty,
                       BigDecimal goodQty, String scanToken, List<Material> inputs) {}

    record GroupCandidateView(Material material, List<String> eligiblePlans) {}
    record GroupMemberView(String key, PlanView snapshot, GroupResult result, List<Material> drawingInputs, Material autoRemnant) {}
    record GroupResponse(String id, List<GroupMemberView> members, List<GroupCandidateView> candidates) {}
    record GroupBody(GroupAction action, String requestId, List<GroupMemberBody> members) {}
    record GroupMemberBody(String key, Long expectedVersion, List<Material> inputs, BigDecimal goodQty, Boolean confirmSkip) {}

    @Bean
    static WebServerFactoryCustomizer<TomcatServletWebServerFactory> drawingKeys() {
        return factory -> factory.addConnectorCustomizers(connector -> connector.setEncodedSolidusHandling("passthrough"));
    }

    @GetMapping("/plans")
    List<PlanOption> plans(HttpServletRequest request) {
        var session = session(request);
        return SEEDS.stream().filter(seed -> sameSite(session, seed.key())).map(DrawingController::option).toList();
    }

    @GetMapping("/groups")
    List<String> groups(HttpServletRequest request) {
        return domain.groups(session(request));
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
                    "records", details.records(), "drawingInputs", materials(details.drawingInputs())));
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
        return ResponseEntity.ok(new ScanView(scan.accepted(), scan.token(), materials(scan.materials())));
    }

    @PostMapping({"/plans/{key}/commands", "/plans/{factory}/{site}/{date}/{seq}/commands"})
    ResponseEntity<?> execute(HttpServletRequest request, @RequestBody CommandBody body) {
        var session = session(request);
        var path = path(request);
        var key = parse(path.substring(0, path.length() - 9));
        if (key == null) return error(400, "INVALID_PLAN_KEY");
        var scope = domain.get(session, key);
        if (scope.status() != 200) return error(scope.status(), scope.error());
        if (body.expectedVersion() == null || body.expectedVersion() < 0) return error(422, "VERSION_REQUIRED");
        var seed = SEEDS.stream().filter(item -> item.key().equals(key)).findFirst().orElseThrow();
        var stock = body.lot() == null
                ? (body.action() == Action.STANDARD_PACK_FINISH ? seed.cutStock() : null)
                : new StockKey(body.lot(), Bin.CUT, seed.item());
        var inputs = inputs(body.inputs());
        var amount = body.action() == Action.DRAW_FINISH ? body.goodQty() : body.qty();
        var result = domain.execute(session, key, new Command(body.action(), body.expectedVersion(),
                body.requestId(), stock, amount, body.scanToken(), inputs));
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
                        shipment.deferred(), shipment.startedAt().toString(), shipment.finishedAt().toString()), snapshot.activeGroupId());
    }

    private static Material material(StockKey stock, BigDecimal quantity) {
        return new Material(stock.lot(), BINS.entrySet().stream().filter(entry -> entry.getValue() == stock.bin())
                .findFirst().orElseThrow().getKey(), stock.item(), quantity);
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

    private static PlanOption option(Seed seed) {
        String type = switch (seed.type()) {
            case DRAWING -> "002";
            case DRAWING_DEFERRED -> "003";
            case STANDARD_PACK -> "PACK";
            case OTHER -> "001";
        };
        return new PlanOption(format(seed.key()), type, seed.item(), seed.cutStock().lot(), seed.orderQuantity());
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
