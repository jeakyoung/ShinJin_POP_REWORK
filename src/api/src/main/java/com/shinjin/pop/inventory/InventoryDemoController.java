package com.shinjin.pop.inventory;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.inventory.InMemoryInventoryDomain;
import synthetic.inventory.InventoryDomain;
import synthetic.inventory.InventoryDomain.*;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/inventory-moves")
public final class InventoryDemoController {
    private static final Site NORTH = new Site("FACTORY-DEMO", "SITE-NORTH");
    private static final Site SOUTH = new Site("FACTORY-DEMO", "SITE-SOUTH");
    private static final Location A1 = new Location("BIN-A", "A-01");
    private static final Location A2 = new Location("BIN-A", "A-02");
    private static final Location B1 = new Location("BIN-B", "B-01");
    private static final Location B2 = new Location("BIN-B", "B-02");
    private static final Location C1 = new Location("BIN-C", "C-01");
    private static final Location D1 = new Location("BIN-D", "D-01");
    private static final Lot X = new Lot("ITEM-X", "LOT-X");
    private static final Lot X2 = new Lot("ITEM-X", "LOT-X2");
    private static final Lot Y = new Lot("ITEM-Y", "LOT-Y");

    private final InventoryDomain inventory = new InMemoryInventoryDomain(Clock.systemUTC(), Map.of(
            NORTH, new Seed(Map.of(
                    "DEMO-A", new TerminalAccess(Set.of(A1, A2, B1, B2), true),
                    "DEMO-A2", new TerminalAccess(Set.of(A1, A2), false)),
                    Map.of(new StockKey(X, A1), new BigDecimal("5.000"),
                           new StockKey(X, A2), new BigDecimal("2.000"),
                           new StockKey(X, B1), new BigDecimal("1.000"),
                           new StockKey(X2, A1), new BigDecimal("3.000"),
                           new StockKey(Y, B2), new BigDecimal("4.000"))),
            SOUTH, new Seed(Map.of("DEMO-B", new TerminalAccess(Set.of(C1, D1), true)),
                    Map.of(new StockKey(X, C1), new BigDecimal("2.000")))));

    public record Failure(String code) {}
    public record BalanceView(Lot lot, Location location, String quantity) {}
    public record MovementView(String id, Lot lot, Location source, Location destination, String quantity,
                               Status status, Actor movedBy, Instant movedAt, Actor cancelledBy, Instant cancelledAt) {}
    public record InventoryView(Actor actor, long version, boolean canMove, List<Location> locations,
                                List<BalanceView> balances, List<MovementView> movements) {}
    public record CommandResult(long version, MovementView movement) {}

    @GetMapping
    public ResponseEntity<?> list(HttpServletRequest request) {
        var reply = inventory.view(actor(request));
        if (reply.status() != 200) return response(reply.status(), new Failure(reply.error()));
        var view = reply.value();
        return response(200, new InventoryView(view.actor(), view.version(), view.canMove(), view.locations(),
                view.balances().stream().map(row -> new BalanceView(row.lot(), row.location(),
                        row.quantity().toPlainString())).toList(),
                view.movements().stream().map(InventoryDemoController::movement).toList()));
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public ResponseEntity<?> command(HttpServletRequest request, @RequestBody Command command) {
        var reply = inventory.execute(actor(request), command);
        if (reply.status() != 200) return response(reply.status(), new Failure(reply.error()));
        return response(200, new CommandResult(reply.value().version(), movement(reply.value().movement())));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> malformed() {
        return response(400, new Failure("MALFORMED_COMMAND"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<?> sessionError(ResponseStatusException error) {
        int status = error.getStatusCode().value();
        return response(status, new Failure(status == 401 ? "LOGIN_REQUIRED" : "TERMINAL_OUT_OF_SCOPE"));
    }

    private static MovementView movement(Movement row) {
        return new MovementView(row.id(), row.lot(), row.source(), row.destination(), row.quantity().toPlainString(),
                row.status(), row.movedBy(), row.movedAt(), row.cancelledBy(), row.cancelledAt());
    }

    private static ResponseEntity<?> response(int status, Object body) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(body);
    }

    private static Actor actor(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        String terminal = identity.terminal().id();
        Site site = switch (terminal) {
            case "DEMO-A", "DEMO-A2" -> NORTH;
            case "DEMO-B" -> SOUTH;
            default -> throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Inventory terminal unavailable");
        };
        return new Actor(site, terminal, identity.worker().id());
    }
}
