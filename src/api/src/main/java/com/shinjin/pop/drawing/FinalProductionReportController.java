package com.shinjin.pop.drawing;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.drawing.DrawingDomain;
import synthetic.drawing.InMemoryDrawingDomain;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/production-report")
public final class FinalProductionReportController {
    private final InMemoryDrawingDomain drawing;

    public FinalProductionReportController(InMemoryDrawingDomain drawing) {
        this.drawing = drawing;
    }

    public record Row(String order, String plan, int run, String process, String material,
                      String part, String spec, BigDecimal ordered, BigDecimal good, BigDecimal bad,
                      String warehouse, String worker, String started, String finished) {}

    @GetMapping
    ResponseEntity<List<Row>> find(@RequestParam("date") LocalDate date,
                                   @RequestParam("sequence") int sequence, HttpServletRequest request) {
        var session = DrawingController.session(request);
        if (sequence < 1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid plan sequence");
        var key = new DrawingDomain.PlanKey(session.factory(), session.site(), date, sequence);
        if (!DrawingController.scopedPlanKeys(session).contains(key)) return response(List.of());

        synchronized (drawing) {
            var snapshot = drawing.get(session, key);
            if (snapshot.status() != 200 || snapshot.value().shipment() == null) return response(List.of());
            var shipment = snapshot.value().shipment();
            var completed = drawing.audit(session, key).records().stream()
                    .filter(record -> (record.action() == DrawingDomain.Action.PACK2_FINISH
                            || record.action() == DrawingDomain.Action.STANDARD_PACK_FINISH)
                            && shipment.id().equals(record.shipmentId()))
                    .findFirst();
            return response(completed.map(record -> List.of(new Row("", date.format(DateTimeFormatter.BASIC_ISO_DATE)
                    + "-" + sequence, 1, record.action() == DrawingDomain.Action.STANDARD_PACK_FINISH
                            ? "\uc77c\ubc18 \ud3ec\uc7a5" : "\u0032\ucc28 \ud3ec\uc7a5", "", shipment.stock().item(), "",
                    null, shipment.quantity(), null, shipment.stock().bin().name(), record.operator(),
                    shipment.startedAt().toString(), shipment.finishedAt().toString()))).orElseGet(List::of));
        }
    }

    private static ResponseEntity<List<Row>> response(List<Row> rows) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(rows);
    }
}
