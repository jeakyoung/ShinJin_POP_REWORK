package com.shinjin.pop.management;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.management.ManagementDemo;
import synthetic.management.ManagementDemo.Actor;
import synthetic.management.ManagementDemo.Command;
import synthetic.management.ManagementDemo.Repair;
import synthetic.management.ManagementDemo.RepairStatus;
import synthetic.management.ManagementDemo.Reply;
import synthetic.management.ManagementDemo.ReturnCommand;
import synthetic.management.ManagementDemo.Site;
import synthetic.management.ManagementDemo.Stock;
import synthetic.management.ManagementDemo.StockKey;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/management")
public final class ManagementDemoController {
    private static final Site A = new Site("F1", "000001");
    private static final Site B = new Site("F2", "000002");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 25);

    private final ManagementDemo domain = new ManagementDemo(
            Clock.fixed(Instant.parse("2026-11-25T01:00:00Z"), ZoneOffset.UTC),
            List.of(
                    new Stock(A, new StockKey("SUP-01", "LOT-M1", "WH-M1", "BIN-01"), "샘플 장갑", "SAFETY", "HAND", "GENERAL", 6),
                    new Stock(A, new StockKey("SUP-01", "LOT-M1", "WH-M1", "BIN-02"), "샘플 장갑", "SAFETY", "HAND", "GENERAL", 3),
                    new Stock(A, new StockKey("SUP-02", "LOT-M2", "WH-M1", "BIN-03"), "샘플 청소포", "SHOP", "CLEAN", "GENERAL", 4),
                    new Stock(B, new StockKey("SUP-01", "LOT-M1", "WH-M1", "BIN-01"), "샘플 장갑", "SAFETY", "HAND", "GENERAL", 2),
                    new Stock(B, new StockKey("SUP-03", "LOT-M3", "WH-M2", "BIN-01"), "샘플 보호대", "SAFETY", "HAND", "GENERAL", 1)),
            List.of(
                    new Repair(A, "REPAIR-A1", "EQ-A1", "합성 점검", DAY.minusMonths(1), DAY.minusDays(25), "점검 완료"),
                    new Repair(A, "REPAIR-A2", "EQ-A2", "합성 이상 확인", DAY, null, null),
                    new Repair(A, "REPAIR-OLD", "EQ-A1", "합성 이전 기록", DAY.minusMonths(1).minusDays(1), DAY.minusMonths(1), "확인 완료"),
                    new Repair(B, "REPAIR-B1", "EQ-B1", "합성 정비", DAY, DAY, "정비 완료")));

    public record Failure(String code) {}

    @GetMapping("/expendables/catalog")
    ResponseEntity<?> catalog(HttpServletRequest request, @RequestParam(required = false) String materialFlag,
                              @RequestParam(required = false) String kind1, @RequestParam(required = false) String kind2) {
        return response(domain.catalog(actor(request), materialFlag, kind1, kind2));
    }

    @GetMapping("/expendables/recent")
    ResponseEntity<?> recent(HttpServletRequest request) {
        return response(domain.recent(actor(request)));
    }

    @GetMapping("/expendables/history")
    ResponseEntity<?> history(HttpServletRequest request) {
        return response(domain.history(actor(request)));
    }

    @PostMapping(path = "/expendables/issues", consumes = "application/json")
    ResponseEntity<?> issue(HttpServletRequest request, @RequestBody Command command) {
        return response(domain.issue(actor(request), command));
    }

    @GetMapping("/expendables/returns")
    ResponseEntity<?> returns(HttpServletRequest request) {
        return response(domain.returnView(actor(request)));
    }

    @PostMapping(path = "/expendables/returns", consumes = "application/json")
    ResponseEntity<?> returnStock(HttpServletRequest request, @RequestBody ReturnCommand command) {
        return response(domain.returnStock(actor(request), command));
    }

    @GetMapping("/repairs")
    ResponseEntity<?> repairs(HttpServletRequest request,
                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                              @RequestParam(defaultValue = "ALL") RepairStatus status) {
        return response(domain.repairs(actor(request), from, to, status));
    }

    private static Actor actor(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        String terminal = identity.terminal().id();
        String worker = identity.worker().id();
        return switch (terminal) {
            case "DEMO-A" -> new Actor(A, "CUTTING", terminal, worker);
            case "DEMO-A2" -> new Actor(A, "PACKING", terminal, worker);
            case "DEMO-B" -> new Actor(B, "PACKING", terminal, worker);
            default -> throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Management terminal unavailable");
        };
    }

    private static ResponseEntity<?> response(Reply<?> reply) {
        return ResponseEntity.status(reply.status()).cacheControl(CacheControl.noStore())
                .body(reply.code() == null ? reply.value() : new Failure(reply.code()));
    }
}
