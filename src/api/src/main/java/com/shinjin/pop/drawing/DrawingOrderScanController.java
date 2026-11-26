package com.shinjin.pop.drawing;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.json.JsonMapper;
import synthetic.drawing.DrawingDomain.PlanKey;
import synthetic.drawing.DrawingDomain.State;
import synthetic.drawing.InMemoryDrawingDomain;

@Profile("demo")
@RestController
@RequestMapping("/api/drawing-008/order-scan")
public class DrawingOrderScanController {
    record Order(String factory, String site, String orderNo, String qualityCode, boolean drawing,
                 String terminal, String warehouse, String material, List<String> plans) {}
    record Lookup(String barcode, List<String> listed) {}
    record Plan(String key, String material) {}

    private final List<Order> orders;
    private final TerminalSettingsDemoController settings;
    private final InMemoryDrawingDomain domain;

    DrawingOrderScanController(TerminalSettingsDemoController settings, InMemoryDrawingDomain domain,
            @Value("${shinjin.demo.drawing-orders:classpath:demo/drawing-orders.json}") Resource dataset) throws IOException {
        this.settings = settings;
        this.domain = domain;
        try (var stream = dataset.getInputStream()) {
            orders = List.of(JsonMapper.builder().build().readValue(stream, Order[].class));
        }
    }

    @PostMapping
    ResponseEntity<?> find(@RequestBody Lookup lookup, HttpServletRequest request) {
        var session = DrawingController.session(request);
        if (lookup.barcode() == null || lookup.barcode().length() != 16 || lookup.barcode().charAt(6) != 'S') {
            return ResponseEntity.badRequest().body(Map.of("error", "INVALID_ORDER_BARCODE"));
        }
        var config = settings.appliedValues(DemoSessionController.requireIdentity(request), request);
        var number = lookup.barcode().substring(0, 12);
        var quality = lookup.barcode().substring(12);
        var atSite = orders.stream().filter(row -> row.site().equals(session.site()) && row.factory().equals(session.factory())
                && row.orderNo().equals(number)).toList();
        var rows = atSite.stream().filter(row -> row.qualityCode().equals(quality) && row.terminal().equals(session.terminal())
                && row.warehouse().equals(config.warehouse()) && row.drawing()).toList();
        if (rows.isEmpty()) {
            String error = !atSite.isEmpty() && atSite.stream().noneMatch(Order::drawing) ? "ORDER_NOT_DRAWING" : "ORDER_NOT_REGISTERED";
            return ResponseEntity.status(404).body(Map.of("error", error));
        }
        String prefix = session.factory() + "/" + session.site() + "/";
        var listed = lookup.listed() == null ? List.<String>of() : lookup.listed();
        var plans = rows.stream().flatMap(row -> row.plans().stream().map(plan -> new Plan(prefix + plan, row.material())))
                .filter(plan -> !listed.contains(plan.key())).distinct().toList();
        if (plans.isEmpty()) return ResponseEntity.ok(plans);
        if (plans.stream().noneMatch(plan -> config.materials().contains(plan.material()))) {
            return ResponseEntity.unprocessableContent().body(Map.of("error", "MATERIAL_NOT_REGISTERED"));
        }
        for (Order row : orders) {
            if (!row.terminal().equals(session.terminal()) || !row.factory().equals(session.factory()) || !row.site().equals(session.site())
                    || row.material().equals(plans.get(0).material())) continue;
            for (String plan : row.plans()) {
                if (!listed.contains(prefix + plan)) continue;
                var parts = plan.split("/");
                var key = new PlanKey(session.factory(), session.site(), LocalDate.parse(parts[0], DateTimeFormatter.BASIC_ISO_DATE),
                        Integer.parseInt(parts[1]));
                var detail = domain.get(session, key);
                if (detail.status() == 200 && (detail.value().state() == State.CUT_READY || detail.value().state() == State.DRAW_READY)) {
                    return ResponseEntity.unprocessableContent().body(Map.of("error", "MATERIAL_MISMATCH"));
                }
            }
        }
        return ResponseEntity.ok(plans);
    }
}
