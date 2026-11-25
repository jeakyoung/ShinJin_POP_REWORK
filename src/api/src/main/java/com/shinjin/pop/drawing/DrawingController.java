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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.drawing.DrawingDomain.*;
import synthetic.drawing.InMemoryDrawingDomain;

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
            seed("F2", "000002", 1, OrderType.DRAWING, "E", true));

    private final InMemoryDrawingDomain domain = new InMemoryDrawingDomain(
            Clock.fixed(Instant.parse("2026-11-25T01:00:00Z"), ZoneOffset.UTC), SEEDS);

    record PlanOption(String key, String fgUse2, String item, String cutLot, BigDecimal orderQuantity) {}
    record Material(String lot, String warehouse, String item, BigDecimal qty) {
        StockKey stock() { return new StockKey(lot, warehouse == null ? null : BINS.get(warehouse), item); }
    }
    record ShipmentView(String id, Material material, boolean deferred, String startedAt, String finishedAt) {}
    record PlanView(State state, String plateFlag, long version, String ownerTerminalId,
                    boolean bypassedPack1, String shipPlanId, ShipmentView shipment) {}
    record ScanBody(Decision decision) {}
    record ScanView(boolean accepted, String scanToken, List<Material> materials) {}
    record CommandBody(Action action, Long expectedVersion, String requestId, String lot, BigDecimal qty,
                       BigDecimal goodQty, String scanToken, List<Material> inputs) {}

    @Bean
    static WebServerFactoryCustomizer<TomcatServletWebServerFactory> drawingKeys() {
        return factory -> factory.addConnectorCustomizers(connector -> connector.setEncodedSolidusHandling("passthrough"));
    }

    @GetMapping("/plans")
    List<PlanOption> plans(HttpServletRequest request) {
        var session = session(request);
        return SEEDS.stream().filter(seed -> sameSite(session, seed.key())).map(DrawingController::option).toList();
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
                    "records", details.records()));
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
        return ResponseEntity.ok(new ScanView(scan.accepted(), scan.token(), scan.materials().stream()
                .map(input -> material(input.stock(), input.quantity())).toList()));
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
        var stock = body.lot() == null ? null : new StockKey(body.lot(), Bin.CUT, seed.item());
        var inputs = body.inputs() == null ? List.<Input>of() : body.inputs().stream()
                .map(item -> item == null ? new Input(null, null) : new Input(item.stock(), item.qty())).toList();
        var amount = body.action() == Action.DRAW_FINISH ? body.goodQty() : body.qty();
        var result = domain.execute(session, key, new Command(body.action(), body.expectedVersion(),
                body.requestId(), stock, amount, body.scanToken(), inputs));
        return result.status() == 200 ? ResponseEntity.ok(view(result.value())) : error(result.status(), result.error());
    }

    private static PlanView view(Snapshot snapshot) {
        var shipment = snapshot.shipment();
        return new PlanView(snapshot.state(), snapshot.plateFlag(), snapshot.version(), snapshot.ownerTerminal(),
                snapshot.bypassedPack1(), shipment == null ? null : shipment.id(),
                shipment == null ? null : new ShipmentView(shipment.id(), material(shipment.stock(), shipment.quantity()),
                        shipment.deferred(), shipment.startedAt().toString(), shipment.finishedAt().toString()));
    }

    private static Material material(StockKey stock, BigDecimal quantity) {
        return new Material(stock.lot(), BINS.entrySet().stream().filter(entry -> entry.getValue() == stock.bin())
                .findFirst().orElseThrow().getKey(), stock.item(), quantity);
    }

    private static Session session(HttpServletRequest request) {
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

    private static Seed seed(String factory, String site, int sequence, OrderType type, String code, boolean hasRemnant) {
        var item = "ITEM-" + code;
        var cut = new StockKey("CUT-" + code, Bin.CUT, item);
        var remnant = new StockKey("REM-" + code, Bin.REMNANT, item);
        var stock = new java.util.HashMap<StockKey, BigDecimal>();
        stock.put(cut, BigDecimal.valueOf(4));
        if (hasRemnant) stock.put(remnant, BigDecimal.valueOf(2));
        return new Seed(new PlanKey(factory, site, DATE, sequence), type, item, BigDecimal.valueOf(4), cut, remnant, stock);
    }

    private static PlanOption option(Seed seed) {
        String type = switch (seed.type()) {
            case DRAWING -> "002";
            case DRAWING_DEFERRED -> "003";
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

    private static String format(PlanKey key) {
        return String.join("/", key.factory(), key.site(), key.date().format(DATE_KEY), Integer.toString(key.sequence()));
    }

    private static ResponseEntity<Map<String, String>> error(int status, String code) {
        return ResponseEntity.status(status).body(Map.of("error", code));
    }
}
