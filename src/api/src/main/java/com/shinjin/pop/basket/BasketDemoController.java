package com.shinjin.pop.basket;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
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

    private final BasketDomain domain = new InMemoryBasketDomain(Clock.systemUTC(), Map.of(
            CENTER_003, seed("DEMO-A", Mode.BASKET),
            CENTER_103, seed("DEMO-A2", Mode.BASKET),
            CHECKED, seed("DEMO-B", Mode.CHECKED_LIST)));

    public record Failure(String code) {}

    @GetMapping
    public ResponseEntity<?> view(HttpServletRequest request) {
        return response(domain.view(actor(request)));
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public ResponseEntity<?> command(HttpServletRequest request, @RequestBody Command command) {
        return response(domain.execute(actor(request), command));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Failure> malformed() { return failure(400, "MALFORMED_COMMAND"); }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Failure> identityFailure(ResponseStatusException error) {
        int status = error.getStatusCode().value();
        return failure(status, status == 401 ? "LOGIN_REQUIRED" : "TERMINAL_OUT_OF_SCOPE");
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
        return new Actor(scope, terminal, identity.worker().id());
    }

    private static ResponseEntity<?> response(Reply<?> reply) {
        if (reply.status() != 200) return failure(reply.status(), reply.error());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(reply.value());
    }

    private static ResponseEntity<Failure> failure(int status, String code) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new Failure(code));
    }

    private static Seed seed(String terminal, Mode mode) {
        boolean started = mode == Mode.CHECKED_LIST;
        Group group = new Group("GROUP-DEMO-CHECKED", terminal, List.of(new Issue(LOT, BigDecimal.ONE)),
                List.of(), Instant.parse("2030-01-01T01:00:00Z"));
        Phase phase = started ? Phase.STARTED : Phase.READY;
        String id = started ? group.id() : null;
        return new Seed(mode, Map.of(terminal, true),
                List.of(work(terminal, 1, phase, id), work(terminal, 2, phase, id),
                        work(terminal, 3, Phase.COMPLETED, null)),
                started ? List.of(group) : List.of(), Map.of(LOT, BigDecimal.TEN), Set.of(RETURN));
    }

    private static Work work(String terminal, int sequence, Phase phase, String id) {
        var key = new PlanKey(LocalDate.of(2030, 1, terminal.equals("DEMO-A") ? 1 : terminal.equals("DEMO-A2") ? 2 : 3), sequence);
        return new Work(new Plan(key, "ORDER-" + terminal, sequence, LOT.item()), phase, id);
    }
}
