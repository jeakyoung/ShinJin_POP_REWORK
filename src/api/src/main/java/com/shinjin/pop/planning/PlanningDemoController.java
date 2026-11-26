package com.shinjin.pop.planning;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import synthetic.planning.InMemoryPlanningDomain;
import synthetic.planning.PlanningDomain;
import synthetic.planning.PlanningDomain.*;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/planning")
public final class PlanningDemoController {
    private static final Site NORTH = new Site("FACTORY-DEMO", "SITE-NORTH", "CENTER-A");
    private static final Site SOUTH = new Site("FACTORY-DEMO", "SITE-SOUTH", "CENTER-B");
    private static final LocalDate DATE = LocalDate.of(2030, 1, 2);
    private static final Spec CUT = new Spec("GRADE-DEMO", WorkState.CUT, n("2"), n("80"), n("100"));
    private static final Spec FINISHED = new Spec("GRADE-DEMO", WorkState.FINISHED, n("2"), n("70"), n("100"));

    private final PlanningDomain planning = new InMemoryPlanningDomain(
            Clock.fixed(Instant.parse("2030-01-02T01:00:00Z"), ZoneOffset.UTC), Map.of(
                    NORTH, north(), SOUTH, south()));

    public record Failure(String code) {}

    @GetMapping
    public ResponseEntity<?> list(HttpServletRequest request,
            @RequestParam(name = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(name = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(name = "status", required = false) Status status,
            @RequestParam(name = "branch", required = false) Branch branch) {
        return response(planning.view(actor(request), new Filter(from, to, status, branch)));
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public ResponseEntity<?> command(HttpServletRequest request, @RequestBody Command command) {
        return response(planning.execute(actor(request), command));
    }

    @GetMapping("/followups")
    public ResponseEntity<?> followups(HttpServletRequest request) {
        return response(planning.followups(actor(request)));
    }

    @PostMapping("/management")
    public ResponseEntity<?> management(HttpServletRequest request, @RequestBody ManagementCommand command) {
        return response(planning.addManagement(actor(request), command));
    }

    @PostMapping("/batch")
    public ResponseEntity<?> batch(HttpServletRequest request, @RequestBody BatchCommand command) {
        return response(planning.batch(actor(request), command));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Failure> malformed() {
        return failure(400, "MALFORMED_COMMAND");
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<Failure> invalidFilter() {
        return failure(400, "INVALID_FILTER");
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Failure> sessionError(ResponseStatusException error) {
        int status = error.getStatusCode().value();
        return failure(status, status == 401 ? "LOGIN_REQUIRED" : "TERMINAL_OUT_OF_SCOPE");
    }

    PlanningDomain domain() { return planning; }

    static Actor actor(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        String terminal = identity.terminal().id();
        Site site = switch (terminal) {
            case "DEMO-A", "DEMO-A2" -> NORTH;
            case "DEMO-B" -> SOUTH;
            default -> throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Planning terminal unavailable");
        };
        return new Actor(site, terminal, identity.worker().id());
    }

    private static ResponseEntity<?> response(Reply<?> reply) {
        if (reply.status() != 200) return failure(reply.status(), reply.error());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(reply.value());
    }

    private static ResponseEntity<Failure> failure(int status, String error) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new Failure(error));
    }

    private static Seed north() {
        var first = new OrderKey("ORDER-DEMO-A", 2, 1);
        var second = new OrderKey("ORDER-DEMO-A", 2, 2);
        var third = new OrderKey("ORDER-DEMO-C", 0, 1);
        var orders = List.of(
                new Order(first, "CUSTOMER-DEMO-A", "ITEM-CUT", CUT, "BIN-INPUT", n("12"), n("4")),
                new Order(second, "CUSTOMER-DEMO-A", "ITEM-CUT", CUT, "BIN-INPUT", n("3"), n("3")),
                new Order(third, "CUSTOMER-DEMO-C", "ITEM-FINISHED", FINISHED, "BIN-PRODUCT", n("2"), n("2")));
        var plans = List.of(
                standard(DATE, 1, first, Status.PLANNED, "ITEM-CUT", CUT, "BIN-INPUT", "4"),
                standard(DATE, 2, second, Status.STARTED, "ITEM-CUT", CUT, "BIN-INPUT", "3"),
                standard(DATE.minusDays(1), 3, third, Status.COMPLETED, "ITEM-FINISHED", FINISHED, "BIN-PRODUCT", "2"));
        var materials = List.of(
                new Material(new MaterialKey("ITEM-CUT", "LOT-DEMO-A", "BIN-INPUT", "POS-01"), CUT, n("5")),
                new Material(new MaterialKey("ITEM-CUT", "LOT-DEMO-A", "BIN-INPUT", "POS-02"), CUT, n("2")),
                new Material(new MaterialKey("ITEM-FINISHED", "LOT-DEMO-B", "BIN-PRODUCT", "POS-01"), FINISHED, n("2")));
        return new Seed(Map.of("DEMO-A", true, "DEMO-A2", false), Set.of("BIN-INPUT", "BIN-PRODUCT"),
                orders, plans, materials, Map.of(CUT, "ITEM-CUT", FINISHED, "ITEM-FINISHED"));
    }

    private static Seed south() {
        var key = new OrderKey("ORDER-DEMO-S", 0, 1);
        return new Seed(Map.of("DEMO-B", true), Set.of("BIN-SOUTH"),
                List.of(new Order(key, "CUSTOMER-DEMO-S", "ITEM-CUT", CUT, "BIN-SOUTH", n("7"), n("0"))),
                List.of(), List.of(), Map.of(CUT, "ITEM-CUT"));
    }

    private static Plan standard(LocalDate date, int seq, OrderKey order, Status status, String item,
                                 Spec spec, String warehouse, String quantity) {
        return new Plan(new PlanKey(date, seq), Branch.STANDARD, status, order, null, order, item,
                spec, warehouse, n(quantity), n("0"), null, null);
    }

    private static BigDecimal n(String number) { return new BigDecimal(number).setScale(3); }
}
