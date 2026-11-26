package com.shinjin.pop.workorders;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.ResourceBundle;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/work-orders")
class ProcessLotLookup {
    private static final ResourceBundle COLUMNS = ResourceBundle.getBundle("demo.work-order-columns", Locale.ROOT);

    record Query(String raw) {}
    record Specification(String terminal, String factory, String order, int line, String workStatus) {}
    record StockLabel(String terminal, String factory, String lot, String material, String name, String grade, String quality,
                      BigDecimal thickness, BigDecimal width, BigDecimal length, String workStatus) {}
    record Dataset(List<Specification> requirements, List<StockLabel> labels) {}
    record Candidate(String factory, String warehouse, String location, String lot, String material, String name,
                     String quality, BigDecimal thickness, BigDecimal width, BigDecimal length, String workStatus,
                     BigDecimal available) {}

    private final WorkOrderFixtures orders;
    private final TerminalSettingsDemoController settings;
    private final Dataset dataset;

    ProcessLotLookup(WorkOrderFixtures orders, TerminalSettingsDemoController settings, ObjectMapper mapper) throws IOException {
        this.orders = orders;
        this.settings = settings;
        try (var stream = new ClassPathResource("demo/process-lot-labels.json").getInputStream()) {
            dataset = mapper.readValue(stream, Dataset.class);
        }
    }

    @PostMapping("/{date}/{sequence}/material-scan")
    ResponseEntity<List<Candidate>> lookup(@PathVariable LocalDate date, @PathVariable int sequence,
            @RequestBody Query query, @RequestParam(required = false) Integer slot, HttpServletRequest request) {
        Scope scope = scope(date, sequence, slot, request);
        if (query.raw() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var detail = scope.detail();
        String factory = scope.actor().terminal().factory();
        String terminal = scope.actor().terminal().id();
        var plan = detail.plan();
        var spec = dataset.requirements().stream().filter(s -> terminal.equals(s.terminal()) && factory.equals(s.factory())
                && plan.orderNumber().equals(s.order()) && plan.orderLine() == s.line()).findFirst();
        var display = plan.getDisplay();
        String gradeKey = plan.orderNumber() + "." + plan.orderLine() + ".mat_quacode";
        var label = dataset.labels().stream().filter(s -> terminal.equals(s.terminal()) && factory.equals(s.factory())
                && query.raw().equals(s.lot()) && COLUMNS.containsKey(gradeKey) && COLUMNS.getString(gradeKey).equals(s.grade())
                && sameDimension(display.thickness(), s.thickness()) && sameDimension(display.width(), s.width())
                && spec.filter(p -> p.workStatus().equals(s.workStatus())).isPresent()).findFirst();
        List<Candidate> rows = label.map(s -> detail.materials().stream().filter(m -> m.lotCode().equals(s.lot()))
                .flatMap(m -> m.positions().stream()).filter(p -> p.availableQuantity().signum() > 0)
                .map(p -> new Candidate(factory, p.position().warehouse(), p.position().location(), s.lot(),
                    s.material(), s.name(), s.quality(), s.thickness(), s.width(), s.length(), s.workStatus(),
                    p.availableQuantity())).toList()).orElseGet(List::of);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(rows);
    }
    record Scope(DemoSessionController.Identity actor, WorkOrderFixtures.Detail detail) {}

    Scope scope(LocalDate date, int sequence, Integer slot, HttpServletRequest request) {
        var actor = DemoSessionController.requireIdentity(request);
        ProcessLotAccess.require(actor, slot);
        String terminal = actor.terminal().id();
        var policy = settings.lotPolicy(actor, request);
        WorkOrderFixtures.Detail detail;
        synchronized (orders) {
            detail = orders.find(terminal, date, sequence, policy)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
            if (!orders.list(terminal, WorkOrderFixtures.State.COMPLETE).isEmpty())
                throw new ResponseStatusException(HttpStatus.CONFLICT);
        }
        return new Scope(actor, detail);
    }

    private static boolean sameDimension(String planValue, BigDecimal stockValue) {
        if (planValue == null) return false;
        try {
            return new BigDecimal(planValue).compareTo(stockValue) == 0;
        } catch (NumberFormatException unavailable) {
            return false;
        }
    }
}
