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
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/management")
public final class ManagementDemoController {
    private static final Site A = new Site("F1", "000001");
    private static final Site B = new Site("F2", "000002");
    record ItemDetail(String name, String specification, String quality, String partNumber) {}
    record Masters(Map<String, String> materialFlags, Map<String, String> kind1, Map<String, Map<String, String>> kind2) {}
    record SupplyDataset(List<Stock> stocks, Map<String, ItemDetail> items, Masters masters) {}
    record SupplyScreen(long revision, Masters masters, Map<String, ItemDetail> items,
                        List<Stock> catalog, List<ManagementDemo.PriorLine> recent, List<ManagementDemo.ReturnLine> held) {}

    private static <T> T fixture(String name, Class<T> type) {
        try (var stream = ManagementDemoController.class.getResourceAsStream("/demo/" + name)) {
            if (stream == null) throw new IllegalStateException("Missing " + name);
            return JsonMapper.builder().build().readValue(stream, type);
        } catch (IOException ex) {
            throw new IllegalStateException("Invalid " + name, ex);
        }
    }

    private final SupplyDataset supplies = fixture("expendables.json", SupplyDataset.class);

    private final ManagementDemo domain = new ManagementDemo(
            Clock.fixed(Instant.parse("2026-11-25T01:00:00Z"), ZoneOffset.UTC),
            supplies.stocks(),
            List.of(fixture("repairs.json", Repair[].class)));

    public record Failure(String code) {}

    @GetMapping("/expendables/screen")
    ResponseEntity<SupplyScreen> supplyScreen(HttpServletRequest request, @RequestParam(required = false) String materialFlag,
                              @RequestParam(required = false) String kind1, @RequestParam(required = false) String kind2) {
        var operator = actor(request);
        synchronized (domain) {
            var catalog = domain.catalog(operator, materialFlag, kind1, kind2).value();
            var recent = domain.recent(operator).value();
            var held = domain.returnView(operator).value().rows().stream().filter(row -> row.remaining() > 0).toList();
            var items = new java.util.HashMap<String, ItemDetail>();
            supplies.stocks().stream().filter(stock -> stock.site().equals(operator.site()))
                    .forEach(stock -> items.put(stock.key().item(), supplies.items().get(stock.key().item())));
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new SupplyScreen(
                    catalog.revision(), supplies.masters(), items, catalog.rows(), recent.rows(), held));
        }
    }

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
