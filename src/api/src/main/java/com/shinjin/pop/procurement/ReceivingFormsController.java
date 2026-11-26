package com.shinjin.pop.procurement;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/procurement/forms")
public final class ReceivingFormsController {
    record PurchaseRow(int index, LocalDate date, String number, String item, BigDecimal quantity, String timestamp,
                       String warehouse, String reflected) {}
    record EscoRow(int index, String shipDate, String inputDate, String shipNumber, String inputNumber, String shipItem,
                   String inputItem, BigDecimal shipQty, BigDecimal inputQty, String shipTime, String inputTime,
                   String warehouse, String warehouseCode) {}
    record PurchaseBatch(String plant, LocalDate date, boolean reject, List<PurchaseRow> before, List<PurchaseRow> after) {}
    record Shipment(String plant, LocalDate date, String number, String failure, List<EscoRow> before, List<EscoRow> after) {}
    record Dataset(LocalDate today, List<PurchaseBatch> purchases, List<Shipment> shipments) {}
    record DayView(LocalDate date, List<PurchaseRow> rows) {}
    record EscoView(String number, List<EscoRow> rows) {}
    record PurchaseCommand(UUID requestId, LocalDate date) {}
    record EscoCommand(UUID requestId, String number, String displayedNumber) {}
    record Key(String plant, String document) {}
    record SessionKey(String terminal, UUID requestId) {}
    record Saved(String worker, String operation, String target) {}
    record Operator(String terminal, String worker, String plant) {}
    record Fault(String code) {}

    private final Dataset dataset;
    private final Set<Key> applied = new HashSet<>();
    private final Map<SessionKey, Saved> commands = new HashMap<>();

    ReceivingFormsController() {
        try (var stream = getClass().getResourceAsStream("/demo/receiving-forms.json")) {
            if (stream == null) throw new IllegalStateException("Missing receiving fixtures");
            dataset = JsonMapper.builder().build().readValue(stream, Dataset.class);
        } catch (IOException ex) {
            throw new IllegalStateException("Invalid receiving fixtures", ex);
        }
    }

    private static Operator operator(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        var plant = switch (identity.terminal().id()) {
            case "DEMO-A", "DEMO-A2" -> "2000";
            case "DEMO-B" -> "1000";
            default -> throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Unknown receiving site");
        };
        return new Operator(identity.terminal().id(), identity.worker().id(), plant);
    }
    private static <T> ResponseEntity<T> ok(T value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }
    private static ResponseEntity<Fault> error(int status, String code) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new Fault(code));
    }

    private PurchaseBatch batch(String plant, LocalDate date) {
        return dataset.purchases().stream().filter(b -> b.plant().equals(plant) && b.date().equals(date)).findFirst().orElse(null);
    }
    private DayView day(String plant, LocalDate date) {
        var batch = batch(plant, date);
        if (batch == null) return new DayView(date, List.of());
        return new DayView(date, applied.contains(new Key(plant, date.toString())) ? batch.after() : batch.before());
    }

    private Shipment shipment(String plant, String number, LocalDate since) {
        return dataset.shipments().stream().filter(s -> s.plant().equals(plant) && s.number().equals(number)
                && !s.date().isBefore(since) && !s.date().isAfter(dataset.today())).findFirst().orElse(null);
    }
    private EscoView document(String plant, String number, Shipment source) {
        if (source == null) return new EscoView(number, List.of());
        return new EscoView(number, applied.contains(new Key(plant, number)) ? source.after() : source.before());
    }

    @GetMapping("/purchase")
    synchronized ResponseEntity<DayView> purchase(HttpServletRequest request, @RequestParam(required=false) LocalDate date) {
        return ok(day(operator(request).plant(), date == null ? dataset.today() : date));
    }

    @PostMapping("/purchase")
    synchronized ResponseEntity<?> applyPurchase(HttpServletRequest request, @RequestBody PurchaseCommand command) {
        var actor = operator(request);
        if (command == null || command.requestId() == null || command.date() == null) return error(422, "INVALID_COMMAND");
        String target = command.date().toString();
        var requestKey = new SessionKey(actor.terminal(), command.requestId());
        var entry = new Saved(actor.worker(), "PURCHASE", target);
        var previous = commands.get(requestKey);
        if (previous != null && !previous.equals(entry)) return error(409, "REQUEST_ID_REUSED");
        var batch = batch(actor.plant(), command.date());
        if (batch != null && batch.reject()) return error(422, "PO_AUTO_FAILED");
        applied.add(new Key(actor.plant(), target));
        commands.put(requestKey, entry);
        return ok(day(actor.plant(), command.date()));
    }

    @GetMapping("/esco")
    synchronized ResponseEntity<EscoView> esco(HttpServletRequest request, @RequestParam String number) {
        var actor = operator(request);
        return ok(document(actor.plant(), number, shipment(actor.plant(), number, dataset.today().withDayOfMonth(1))));
    }

    @PostMapping("/esco")
    synchronized ResponseEntity<?> applyEsco(HttpServletRequest request, @RequestBody EscoCommand command) {
        var actor = operator(request);
        if (command == null || command.requestId() == null || command.number() == null || command.number().length() != 14)
            return error(422, "INVALID_COMMAND");
        String number = command.number();
        var source = shipment(actor.plant(), number, dataset.today().minusMonths(2));
        if (!number.equals(command.displayedNumber())) return error(409, "DOCUMENT_MISMATCH");
        var entry = new Saved(actor.worker(), "ESCO", number);
        var requestKey = new SessionKey(actor.terminal(), command.requestId());
        var previous = commands.get(requestKey);
        if (previous != null && !previous.equals(entry)) return error(409, "REQUEST_ID_REUSED");
        if (source == null || source.after().isEmpty()) return ok(new EscoView(number, List.of()));
        if (source.failure() != null) return error(422, source.failure());
        // The recorded fixture supplies the result after ERP creation, per-row monthly adjustment and POP receipt.
        applied.add(new Key(actor.plant(), number));
        commands.put(requestKey, entry);
        return ok(document(actor.plant(), number, source));
    }
}
