package com.shinjin.pop.shipping;

import com.shinjin.pop.drawing.DrawingShippingBridge;
import com.shinjin.pop.output.SyntheticOutput;
import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.output.DemoReportPrinter;
import com.shinjin.pop.output.DemoReportPrinter.*;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.OptionalInt;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.shipping.InMemoryShippingDomain;
import synthetic.shipping.ShippingDomain;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ResourceLoader;
import java.util.List;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/shipping")
public final class ShippingDemoController {
    public record State(String terminal, String worker, List<ShippingDomain.Snapshot> rows) {}
    public record Failure(String code) {}

    private final DrawingShippingBridge source;
    private final InMemoryShippingDomain shipping = new InMemoryShippingDomain(Clock.systemUTC());

    public record PrintResult(String mode, String status, String device, int pages, String delivery, boolean logIntent) {}
    public record PrintedRow(ShippingDomain.Handoff handoff, ShippingDomain.Status status, long version,
                             ShippingDomain.Shipment shipment, int reprintCount, PrintResult print) {}
    private record ReceiptKey(String handoff, String request) {}
    public record DeviceCall(String shipment, String requestId, String device, int pages, Integer copies) {}
    private final Map<ReceiptKey, DeviceCall> spool = new LinkedHashMap<>();
    private final Map<ReceiptKey, PrintResult> receipts = new LinkedHashMap<>();
    private final TerminalSettingsDemoController settings;
    private final SyntheticOutput output;

    public ShippingDemoController(DrawingShippingBridge source, SyntheticOutput output, TerminalSettingsDemoController settings) {
        this.settings = settings;
        this.source = source;
        this.output = output;
    }

    @Autowired
    void configureForms(ResourceLoader loader, @Value("${pop.demo.shipping-fixture:}") String fixture) {
        if (!fixture.isBlank()) forms = new ShippingFormCatalog(loader.getResource(fixture));
    }

    private ShippingFormCatalog forms = new ShippingFormCatalog(null);
    private final Map<String,LocalDate> shipmentDates = new LinkedHashMap<>();
    private final Map<String,BatchReceipt> batchReceipts = new LinkedHashMap<>();
    private record BatchReceipt(ShippingDomain.Actor actor, BatchCommand command, BatchState result) {}
    public record FormRow(ShippingDomain.Snapshot snapshot, ShippingFormCatalog.Info info, LocalDate shippingDate) {}
    public record FormState(String terminal,String worker,List<FormRow> rows,List<ShippingFormCatalog.Info> options) {}
    public record Selection(String id, long version) {}
    public record BatchCommand(String requestId, ShippingDomain.Action action, LocalDate shippingDate,
                               List<Selection> rows, Boolean printChecked) {}
    public record BatchState(List<ShippingDomain.Snapshot> rows, Map<String,PrintResult> documents) {}
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    @GetMapping("/form")
    public synchronized ResponseEntity<FormState> form(HttpServletRequest request, @RequestParam(defaultValue="true") boolean includeRows) {
        var actor = includeRows ? refresh(request) : source.actor(request);
        var prefix = actor.scope().factory() + "/" + actor.scope().site() + "/";
        var options = forms.plans.entrySet().stream().filter(entry -> entry.getKey().startsWith(prefix))
                .sorted(Map.Entry.comparingByKey()).map(Map.Entry::getValue).toList();
        var rows = (includeRows ? shipping.list(actor) : List.<ShippingDomain.Snapshot>of()).stream().map(row -> {
            var shipment = row.shipment();
            var day = shipment == null ? null : shipmentDates.getOrDefault(shipment.number(),
                    LocalDate.ofInstant(shipment.confirmedAt(), SEOUL));
            return new FormRow(row,forms.info(row),day);
        }).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new FormState(actor.terminal(),actor.worker(),rows,options));
    }

    public record PackingSearch(LocalDate dateFrom, LocalDate dateTo, String customerCode, List<String> matquality,
                                List<String> itemKind3, List<String> workcenterCode, String opmanName, String carryOverFlag) {}
    public record CompletedSearch(LocalDate optime, String customerCode) {}

    @PostMapping("/queries/packing")
    public synchronized ResponseEntity<?> packingSearch(HttpServletRequest request, @RequestBody PackingSearch search) {
        if (search == null || search.dateFrom() == null || search.dateTo() == null || search.customerCode() == null
                || search.matquality() == null || search.itemKind3() == null || search.workcenterCode() == null
                || search.opmanName() == null || !("0".equals(search.carryOverFlag()) || "1".equals(search.carryOverFlag())))
            return ResponseEntity.badRequest().body(new Failure("INVALID_SELECTION"));
        var state = form(request,true).getBody();
        var rows = state.rows().stream().filter(row -> {
            var info = row.info();
            return info != null && row.snapshot().status() == ShippingDomain.Status.READY
                    && !info.packingDate().isBefore(search.dateFrom()) && !info.packingDate().isAfter(search.dateTo())
                    && (search.customerCode().isEmpty() || search.customerCode().equals(info.customerCode()))
                    && search.matquality().contains(info.materialCode()) && search.itemKind3().contains(info.itemKindCode())
                    && search.workcenterCode().contains(info.workCenter()) && info.orderWorker().contains(search.opmanName())
                    && forms.matchesCarryFixture(search.carryOverFlag(),row.snapshot());
        }).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new FormState(state.terminal(),state.worker(),rows,state.options()));
    }

    @PostMapping("/queries/completed")
    public synchronized ResponseEntity<?> completedSearch(HttpServletRequest request, @RequestBody CompletedSearch search) {
        if (search == null || search.optime() == null || search.customerCode() == null)
            return ResponseEntity.badRequest().body(new Failure("INVALID_SELECTION"));
        var state = form(request,true).getBody();
        var rows = state.rows().stream().filter(row -> row.info() != null && row.snapshot().status() == ShippingDomain.Status.SHIPPED
                && search.optime().equals(row.shippingDate())
                && (search.customerCode().isEmpty() || search.customerCode().equals(row.info().customerCode()))).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new FormState(state.terminal(),state.worker(),rows,state.options()));
    }

    @PostMapping(path="/batch",consumes="application/json")
    public synchronized ResponseEntity<?> batch(HttpServletRequest request, @RequestBody BatchCommand command) {
        var actor = refresh(request);
        if (command == null || command.requestId() == null || command.requestId().isBlank()
                || command.rows() == null || command.rows().isEmpty() || command.rows().stream().anyMatch(java.util.Objects::isNull)
                || command.action() != ShippingDomain.Action.CONFIRM && command.action() != ShippingDomain.Action.CANCEL
                || command.action() == ShippingDomain.Action.CONFIRM && command.shippingDate() == null) {
            return ResponseEntity.badRequest().body(new Failure("INVALID_COMMAND"));
        }
        var prior = batchReceipts.get(command.requestId());
        if (prior != null) {
            if (!actor.equals(prior.actor())) return ResponseEntity.status(403).body(new Failure("COMMAND_ACTOR_MISMATCH"));
            if (!command.equals(prior.command())) return ResponseEntity.status(409).body(new Failure("REQUEST_ID_CONFLICT"));
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(prior.result());
        }
        var available = shipping.list(actor).stream().collect(Collectors.toMap(row -> row.handoff().id(),Function.identity()));
        var versions = new LinkedHashMap<String,Long>();
        for (var selection : command.rows()) {
            var row = available.get(selection.id());
            if (row == null) return ResponseEntity.status(404).body(new Failure("HANDOFF_NOT_FOUND"));
            if (versions.put(selection.id(),selection.version()) != null) return ResponseEntity.badRequest().body(new Failure("DUPLICATE_HANDOFF"));
            var info = forms.info(row);
            if (info == null) return ResponseEntity.unprocessableEntity().body(new Failure("MISSING_PLAN_DETAILS"));
            if (command.action() == ShippingDomain.Action.CONFIRM) {
                if (info.packingDate().isAfter(command.shippingDate())) return ResponseEntity.unprocessableEntity().body(new Failure("PACKING_AFTER_SHIPMENT"));
                if (row.handoff().quantity().compareTo(info.stock()) > 0) return ResponseEntity.unprocessableEntity().body(new Failure("INSUFFICIENT_STOCK"));
            }
        }
        var draft = versions.keySet().stream().map(available::get).toList();
        var lines = forms.orderedCandidates(draft).stream()
                .map(row -> new InMemoryShippingDomain.BatchLine(row.handoff().id(),versions.get(row.handoff().id()),forms.info(row).grouping())).toList();
        var result = shipping.batch(actor,command.action(),lines);
        if (result.status() != 200) return ResponseEntity.status(result.status()).body(new Failure(result.error()));
        var documents = new LinkedHashMap<String,PrintResult>();
        if (command.action() == ShippingDomain.Action.CONFIRM) {
            for (var row : result.rows()) {
                String number = row.shipment().number();
                if (documents.containsKey(number)) continue;
                shipmentDates.put(number,command.shippingDate());
                var printed = print(request,actor,row,new ShippingDomain.Command(row.handoff().id(),command.action(),
                        row.version(),command.requestId(),command.printChecked(),null));
                receipts.put(new ReceiptKey(row.handoff().id(),command.requestId()),printed);
                documents.put(number,printed);
            }
        }
        var response = new BatchState(result.rows(),Map.copyOf(documents));
        batchReceipts.put(command.requestId(),new BatchReceipt(actor,command,response));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(response);
    }

    @GetMapping
    public ResponseEntity<State> list(HttpServletRequest request) {
        var actor = refresh(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new State(actor.terminal(), actor.worker(), shipping.list(actor)));
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public synchronized ResponseEntity<?> command(HttpServletRequest request, @RequestBody ShippingDomain.Command command) {
        var actor = refresh(request);
        if (command == null || (command.action() != ShippingDomain.Action.CONFIRM && command.printChecked() != null)
                || (command.action() != ShippingDomain.Action.REPRINT && command.previewPrinter() != null)) {
            return ResponseEntity.unprocessableEntity().body(new Failure("INVALID_COMMAND"));
        }
        var key = new ReceiptKey(command.handoffId(), command.requestId());
        var result = shipping.execute(actor, command, row -> {
            var printed = print(request, actor, row, command);
            if (!"SUBMITTED".equals(printed.status())) return printed.status();
            receipts.put(key, printed);
            return null;
        });
        if (result.status() != 200) return ResponseEntity.status(result.status()).body(new Failure(result.error()));
        var row = result.snapshot();
        if (command.action() == ShippingDomain.Action.CONFIRM) {
            receipts.computeIfAbsent(key, ignored -> print(request, actor, row, command));
        }
        var receipt = receipts.get(key);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new PrintedRow(row.handoff(), row.status(),
                row.version(), row.shipment(), row.reprintCount(), receipt));
    }

    private Devices devices(HttpServletRequest request, ShippingDomain.Actor actor) {
        var applied = settings.read(actor.terminal(), request).getBody().view().applied().values().outputs();
        return new Devices(applied.get("document"), applied.get("shipment"));
    }

    private PrintResult print(HttpServletRequest request, ShippingDomain.Actor actor, ShippingDomain.Snapshot row,
                              ShippingDomain.Command command) {
        boolean manual = command.action() == ShippingDomain.Action.REPRINT;
        boolean checked = !Boolean.FALSE.equals(command.printChecked());
        String mode = manual ? "MANUAL" : checked ? "AUTO_PRINT" : "AUTO_EMAIL";
        var delivery = ShippingCustomerFixture.delivery(row.handoff().packingRef());
        if (delivery == null && forms.info(row) != null) delivery = ShippingCustomerFixture.deliveryForCustomer(forms.info(row).customerCode());
        if (!manual && delivery == null) return new PrintResult(mode, "DELIVERY_UNKNOWN", null, 0, null, false);
        String preference = delivery == null ? null : delivery.name();
        try {
            var contract = renderRow(row).contract();
            if (!"PDF_READY".equals(contract.status())) return new PrintResult(mode, contract.status(), null, 0, preference, false);
            var devices = devices(request, actor);
            var key = new ReceiptKey(row.handoff().id(), command.requestId());
            var printer = new DemoReportPrinter(call -> {
                if (call.device() == null || "NONE".equals(call.device())) throw new UnconfiguredPrinter();
                spool.put(key, new DeviceCall(row.shipment().number(), command.requestId(), call.device(),
                        call.documentPages(), call.copies().isPresent() ? call.copies().getAsInt() : null));
            });
            if (manual) {
                if (command.previewPrinter() != null && !command.previewPrinter().equals(devices.printer2())) {
                    return new PrintResult(mode, "PREVIEW_DEVICE_CHANGED", null, 0, preference, false);
                }
                var preview = new Preview(ManualForm.SHIPPING_STATEMENT, devices.printer2(), contract.pages());
                printer.printFromPreview(preview, OptionalInt.empty());
            } else {
                printer.shippingSaved(devices, checked ? ShippingAction.AUTO_PRINT : ShippingAction.AUTO_EMAIL,
                        List.of(new ShippingPages(delivery, contract.pages())));
            }
            var call = spool.get(key);
            if (call == null) return new PrintResult(mode, "NO_PAPER", null, 0, preference, checked);
            return new PrintResult(mode, "SUBMITTED", call.device(), call.pages(), preference, manual || checked);
        } catch (UnconfiguredPrinter ex) {
            return new PrintResult(mode, "PRINTER_UNSET", null, 0, preference, false);
        } catch (RuntimeException ex) {
            return new PrintResult(mode, "PRINT_ERROR", null, 0, preference, false);
        }
    }

    private static final class UnconfiguredPrinter extends RuntimeException {}

    @GetMapping("/{number}/print-jobs")
    public synchronized ResponseEntity<?> jobs(HttpServletRequest request, @PathVariable String number) {
        var row = shipping.document(source.actor(request), number);
        if (row.status() != 200) return ResponseEntity.status(row.status()).body(new Failure(row.error()));
        Set<String> members = shipping.documentRows(number).stream().map(member -> member.handoff().id()).collect(Collectors.toSet());
        var calls = new java.util.ArrayList<>(spool.values().stream().filter(call -> number.equals(call.shipment())).toList());
        for (var call : bundleSpool.values()) if (call.numbers().contains(number)) {
            calls.add(new DeviceCall(number,call.requestId(),call.device(),call.pages(),null));
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("calls", calls,
                "results", receipts.entrySet().stream()
                .filter(e -> members.contains(e.getKey().handoff())).map(Map.Entry::getValue).toList()));
    }

    public record DocumentSelection(List<String> numbers, String requestId, String previewPrinter, List<Selection> expected) {}
    private record PrintedBundle(ShippingDomain.Actor actor, DocumentSelection selection, PrintResult result) {}
    private final Map<String,PrintedBundle> printedBundles = new LinkedHashMap<>();
    public record BundleCall(List<String> numbers, String requestId, String device, int pages) {}
    private final Map<String,BundleCall> bundleSpool = new LinkedHashMap<>();

    @GetMapping("/documents/print-jobs/{requestId}")
    public synchronized ResponseEntity<?> bundleJob(HttpServletRequest request, @PathVariable String requestId) {
        var actor = source.actor(request);
        var recorded = printedBundles.get(requestId);
        if (recorded == null || !recorded.actor().equals(actor)) return ResponseEntity.notFound().build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(bundleSpool.get(requestId));
    }

    @PostMapping("/documents/{operation}")
    public synchronized ResponseEntity<?> documents(HttpServletRequest request, @PathVariable String operation, @RequestBody DocumentSelection selection)
            throws java.io.IOException {
        var actor = source.actor(request);
        if (selection == null || selection.numbers() == null || selection.numbers().isEmpty()
                || selection.numbers().stream().anyMatch(n -> n == null || n.isBlank())
                || selection.numbers().stream().distinct().count() != selection.numbers().size()
                || !List.of("preview","pdf","print").contains(operation)) return ResponseEntity.badRequest().body(new Failure("INVALID_SELECTION"));
        boolean printing = operation.equals("print");
        if (printing) {
            if (selection.requestId() == null || selection.requestId().isBlank() || selection.expected() == null)
                return ResponseEntity.badRequest().body(new Failure("INVALID_COMMAND"));
            var previous = printedBundles.get(selection.requestId());
            if (previous != null) {
                if (!previous.actor().equals(actor)) return ResponseEntity.status(403).body(new Failure("COMMAND_ACTOR_MISMATCH"));
                if (!previous.selection().equals(selection)) return ResponseEntity.status(409).body(new Failure("REQUEST_ID_CONFLICT"));
                return ResponseEntity.ok(previous.result());
            }
        }
        var results = new java.util.ArrayList<SyntheticOutput.Output>();
        var originals = new java.util.ArrayList<ShippingDomain.Snapshot>();
        var expected = new java.util.ArrayList<Selection>();
        for (String number : selection.numbers()) {
            var doc = shipping.document(actor,number);
            if (doc.status() != 200) return ResponseEntity.status(doc.status()).body(new Failure(doc.error()));
            var row = doc.snapshot();
            expected.add(new Selection(row.handoff().id(),row.version()));
            originals.add(row);
            var rendered = renderRow(row);
            if (rendered.pdf() == null) return ResponseEntity.unprocessableEntity().body(new Failure(rendered.contract().status()));
            results.add(rendered);
        }
        var chosen = devices(request,actor).printer2();
        int pages = results.stream().mapToInt(result -> result.contract().pages()).sum();
        if (operation.equals("preview")) {
            var preview = new java.util.ArrayList<Object>();
            for (var result : results) preview.addAll(result.contract().preview());
            var response = new LinkedHashMap<String,Object>();
            response.put("device",chosen); response.put("pages",pages); response.put("preview",preview);
            response.put("expected",expected); response.put("status","PDF_READY");
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(response);
        }
        if (operation.equals("pdf")) {
            try (var merged = new org.apache.pdfbox.pdmodel.PDDocument(); var bytes = new java.io.ByteArrayOutputStream()) {
                var merger = new org.apache.pdfbox.multipdf.PDFMergerUtility();
                for (var result : results) try (var pdf = org.apache.pdfbox.Loader.loadPDF(result.pdf())) { merger.appendDocument(merged,pdf); }
                merged.save(bytes);
                var attachment = ContentDisposition.attachment().filename("shipping-statements.pdf").build();
                return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_PDF)
                        .header(HttpHeaders.CONTENT_DISPOSITION,attachment.toString()).body(bytes.toByteArray());
            }
        }
        if (!expected.equals(selection.expected())) return ResponseEntity.status(409).body(new Failure("STALE_VERSION"));
        if (!java.util.Objects.equals(chosen,selection.previewPrinter())) return ResponseEntity.status(409).body(new Failure("PREVIEW_DEVICE_CHANGED"));
        if (chosen == null || chosen.equals("NONE")) return ResponseEntity.unprocessableEntity().body(new Failure("PRINTER_UNSET"));
        if (originals.stream().anyMatch(row -> row.reprintCount() == Integer.MAX_VALUE)) return ResponseEntity.status(409).body(new Failure("REPRINT_LIMIT_REACHED"));
        var result = new PrintResult("MANUAL","SUBMITTED",chosen,pages,null,true);
        // The native preview submits the complete page collection as one device call.
        var printer = new DemoReportPrinter(call -> {
            bundleSpool.put(selection.requestId(),new BundleCall(List.copyOf(selection.numbers()),selection.requestId(),chosen,call.documentPages()));
            for (var row : originals) {
                var key = new ReceiptKey(row.handoff().id(),selection.requestId());
                receipts.put(key,result);
            }
        });
        printer.printFromPreview(new Preview(ManualForm.SHIPPING_STATEMENT,chosen,pages),OptionalInt.empty());
        shipping.markBundleReprinted(originals);
        printedBundles.put(selection.requestId(),new PrintedBundle(actor,selection,result));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result);
    }

    @GetMapping("/{number}/document")
    ResponseEntity<?> preview(HttpServletRequest request, @PathVariable String number) {
        return render(request, number, false);
    }

    @GetMapping("/{number}/document/pdf")
    ResponseEntity<?> download(HttpServletRequest request, @PathVariable String number) {
        return render(request, number, true);
    }

    private ResponseEntity<?> render(HttpServletRequest request, String number, boolean download) {
        var document = shipping.document(source.actor(request), number);
        if (document.status() != 200) {
            return ResponseEntity.status(document.status()).cacheControl(CacheControl.noStore())
                    .body(new Failure(document.error()));
        }
        var result = renderRow(document.snapshot());
        if (!download && "PDF_READY".equals(result.contract().status())) {
            var actor = source.actor(request);
            var preview = new DemoReportPrinter(call -> { throw new IllegalStateException("preview cannot spool"); })
                    .openPreview(devices(request, actor), ManualForm.SHIPPING_STATEMENT, result.contract().pages());
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Preview-Printer", preview.device()).body(result.contract());
        }
        if (!download) return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result.contract());
        if (result.pdf() == null) {
            return ResponseEntity.status(422).cacheControl(CacheControl.noStore()).body(result.contract());
        }
        var attachment = ContentDisposition.attachment().filename(number + ".pdf").build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, attachment.toString()).body(result.pdf());
    }

    private SyntheticOutput.Output renderRow(ShippingDomain.Snapshot row) {
        var lots = shipping.documentRows(row.shipment().number()).stream().map(member -> {
            var handoff = member.handoff();
            return new SyntheticOutput.ShipmentDocument(row.shipment().number(), handoff.packingRef(),
                    handoff.lot(),handoff.item(),handoff.quantity(),handoff.deferred(),member.shipment().confirmedAt());
        }).toList();
        return output.renderShipment(lots);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Failure> malformed() {
        return ResponseEntity.badRequest().body(new Failure("MALFORMED_COMMAND"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Failure> sourceError(ResponseStatusException error) {
        String code = switch (error.getStatusCode().value()) {
            case 401 -> "LOGIN_REQUIRED";
            case 403 -> "SHIPPING_SCOPE_UNAVAILABLE";
            default -> "PACKING_SOURCE_UNAVAILABLE";
        };
        return ResponseEntity.status(error.getStatusCode()).body(new Failure(code));
    }

    private ShippingDomain.Actor refresh(HttpServletRequest request) {
        var feed = source.read(request);
        try {
            feed.handoffs().forEach(shipping::publish);
            forms.optionalHandoffs.stream().map(ShippingFormCatalog.FixtureRow::handoff)
                    .filter(row -> row.scope().equals(feed.actor().scope())).forEach(shipping::publish);
        } catch (IllegalArgumentException | IllegalStateException error) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "Packing handoff inconsistent", error);
        }
        return feed.actor();
    }
}
