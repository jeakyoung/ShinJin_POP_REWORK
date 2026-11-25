package com.shinjin.pop.procurement;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import synthetic.procurement.ProcurementReceiving;
import synthetic.procurement.ProcurementReceiving.Actor;
import synthetic.procurement.ProcurementReceiving.Command;
import synthetic.procurement.ProcurementReceiving.LineSeed;
import synthetic.procurement.ProcurementReceiving.Reply;
import synthetic.procurement.ProcurementReceiving.Selection;
import synthetic.procurement.ProcurementReceiving.SourceKey;
import synthetic.procurement.ProcurementReceiving.SourceSeed;
import synthetic.procurement.ProcurementReceiving.SourceType;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/procurement")
public class ProcurementDemoController {
    private static final LocalDate DAY = LocalDate.of(2026, 11, 25);
    private final ProcurementReceiving receiving = new ProcurementReceiving(
            Clock.fixed(Instant.parse("2026-11-25T01:00:00Z"), ZoneOffset.UTC), List.of(
            new SourceSeed("DEMO-A", new SourceKey(SourceType.ESCO_SHIPMENT, "SRC-001"), DAY, List.of(
                    line(10, "ITEM-A", "WH-ESCO", "5.500"), line(20, "ITEM-B", "WH-ESCO", "3.000"))),
            new SourceSeed("DEMO-A", new SourceKey(SourceType.PURCHASE_ORDER, "SRC-001"), DAY, List.of(
                    line(10, "ITEM-A", "WH-PO", "4.000"), line(30, "ITEM-C", "WH-PO", "6.250"))),
            new SourceSeed("DEMO-A", new SourceKey(SourceType.PURCHASE_ORDER, "SRC-OLDER"), DAY.minusDays(1), List.of(
                    line(10, "ITEM-A", "WH-PO", "2.000"))),
            new SourceSeed("DEMO-A2", new SourceKey(SourceType.PURCHASE_ORDER, "SRC-A2"), DAY, List.of(
                    line(10, "ITEM-A", "WH-PO", "2.000"))),
            new SourceSeed("DEMO-B", new SourceKey(SourceType.ESCO_SHIPMENT, "SRC-B1"), DAY, List.of(
                    line(10, "ITEM-A", "WH-ESCO", "1.000")))));

    public record Fault(String code) {}
    public record ReceiptBody(String requestId, Long expectedRevision, List<Selection> lines) {}

    @GetMapping("/sources")
    ResponseEntity<?> list(HttpServletRequest request, @RequestParam SourceType type,
                           @RequestParam(required = false) String number,
                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return response(receiving.list(actor(request), type, number, date));
    }

    @GetMapping("/sources/{type}/{number}")
    ResponseEntity<?> get(HttpServletRequest request, @PathVariable SourceType type, @PathVariable String number) {
        return response(receiving.get(actor(request), new SourceKey(type, number)));
    }

    @GetMapping("/balances")
    ResponseEntity<?> balances(HttpServletRequest request) {
        return response(receiving.balances(actor(request)));
    }

    @PostMapping(path = "/sources/{type}/{number}/receipts", consumes = "application/json")
    ResponseEntity<?> receive(HttpServletRequest request, @PathVariable SourceType type, @PathVariable String number,
                              @RequestBody ReceiptBody body) {
        var actor = actor(request);
        var command = body.expectedRevision() == null ? null
                : new Command(body.requestId(), body.expectedRevision(), body.lines());
        return response(receiving.receive(actor, new SourceKey(type, number), command));
    }

    private static Actor actor(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return new Actor(identity.terminal().id(), identity.worker().id());
    }

    private static LineSeed line(int number, String item, String warehouse, String quantity) {
        return new LineSeed(number, item, warehouse, new BigDecimal(quantity));
    }

    private static ResponseEntity<?> response(Reply<?> reply) {
        return ResponseEntity.status(reply.status()).cacheControl(CacheControl.noStore())
                .body(reply.code() == null ? reply.value() : new Fault(reply.code()));
    }
}
