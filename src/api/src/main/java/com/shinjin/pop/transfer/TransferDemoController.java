package com.shinjin.pop.transfer;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.transfer.InMemoryTransferDomain;
import synthetic.transfer.TransferDomain.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/transfers")
public class TransferDemoController {
    private static final System.Logger LOG = System.getLogger(TransferDemoController.class.getName());
    private static final String SOURCE = "BIN-SOURCE";
    private static final String DESTINATION = "BIN-DEST";
    private final Map<String, FactoryTransfers> factories = new ConcurrentHashMap<>();

    private final TransferMaster master;

    private final TransferFormData forms;

    public TransferDemoController(TransferMaster master, TransferFormData forms) {
        this.master = master;
        this.forms = forms;
    }

    public record Actor(String terminalId, String workerId) {}
    public record Stock(String warehouse, String item, String quantity) {}
    public record ReplayLine(int number, String item, String quantity) {}
    public record ReplayDraft(String source, String destination, List<ReplayLine> lines) {}
    public record ReplayCommand(String request, String commandId, Action action,
                                ReplayDraft draft, DocumentId sourceDocument, boolean autoReceive) {}
    public record Pending(String request, boolean canRetry, ReplayCommand command) {}
    public record Header(String department, String worker, String remark, String number) {}
    public record State(Actor actor, String source, String destination, List<Stock> stock,
                        List<Transfer> transfers, List<Document> documents, List<Pending> pending, Map<Long, LocalDate> documentDates, TransferMaster.Options master, Map<Long, Header> headers,
                        Map<String, List<TransferMaster.ReportLine>> reportLines, FormView forms) {}
    public record CommandBody(Command command, Boolean simulatePopFailure) {}
    public record Result(String code, Transfer transfer, Actor actor) {}
    public record Failure(String code) {}

    private record CommandKey(String request, String commandId) {}

    private static final class FactoryTransfers {
        final InMemoryTransferDomain domain;
        final Map<String, Entry> receipts = new HashMap<>();
        final Map<String, FormRecord> records = new LinkedHashMap<>();
        final Map<LocalDate, Integer> sequences = new HashMap<>();
        FactoryTransfers(TransferFormData forms) {
            domain = new InMemoryTransferDomain(forms.initialStock(Map.of(
                new StockKey(SOURCE, "SKU-X"), new BigDecimal("5.000"),
                new StockKey(SOURCE, "SKU-Y"), new BigDecimal("2.000"),
                new StockKey(DESTINATION, "SKU-X"), BigDecimal.ZERO,
                new StockKey(DESTINATION, "SKU-Y"), BigDecimal.ZERO)));
        }
        final Map<Long, String> workers = new HashMap<>();
        final Map<Long, String> departments = new HashMap<>();
        final Map<Long, LocalDate> dates = new HashMap<>();
        final Map<CommandKey, Actor> actors = new HashMap<>();
    }

    @GetMapping
    public ResponseEntity<State> get(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        Actor actor = actor(identity);
        FactoryTransfers factory = factory(identity);
        synchronized (factory) {
            View view = factory.domain.view();
            var stock = view.stock().entrySet().stream()
                    .map(entry -> new Stock(entry.getKey().warehouse(), entry.getKey().item(),
                            entry.getValue().toPlainString()))
                    .sorted(Comparator.comparing(Stock::warehouse).thenComparing(Stock::item)).toList();
            var transfers = view.transfers().values().stream()
                    .sorted(Comparator.comparing(Transfer::request)).toList();
            var documents = view.activeErpDocuments().values().stream()
                    .sorted(Comparator.comparingLong(document -> document.id().revision())).toList();
            var pending = view.pending().values().stream().sorted(Comparator.comparing(Command::request))
                    .map(command -> {
                        boolean canRetry = actor.equals(factory.actors.get(key(command)));
                        return new Pending(command.request(), canRetry, canRetry ? replay(command) : null);
                    }).toList();
            var headers = new HashMap<Long, Header>();
            var reportLines = new HashMap<String, List<TransferMaster.ReportLine>>();
            for (Document doc : documents) {
                DocumentId id = doc.id();
                headers.put(id.revision(), new Header(factory.departments.get(id.revision()),
                        factory.workers.get(id.revision()), master.headerRemark(id.request()), master.documentNumber(id)));
                if (id.kind() == Kind.REQUEST) {
                    var details = doc.lines().stream().map(row -> master.reportLine(id.request(), row.line().number()))
                            .filter(java.util.Objects::nonNull).toList();
                    reportLines.put(id.request(), details);
                }
            }
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(new State(actor, SOURCE, DESTINATION, stock, transfers, documents, pending, Map.copyOf(factory.dates), options(actor.terminalId()), headers, reportLines, formView(factory, view)));
        }
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public ResponseEntity<Result> command(@RequestBody CommandBody body, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        Actor actor = actor(identity);
        if (body == null || body.command() == null) return result(Code.INVALID_COMMAND, null, actor);
        Command command = body.command();
        FactoryTransfers factory = factory(identity);
        synchronized (factory) {
            CommandKey key = key(command);
            Actor original = factory.actors.get(key);
            if (original != null && !actor.equals(original)) {
                return ResponseEntity.status(403).body(new Result("COMMAND_ACTOR_MISMATCH", null, actor));
            }
            if (command.draft() != null && (!SOURCE.equals(command.draft().source())
                    || !DESTINATION.equals(command.draft().destination())
                    || command.draft().lines().stream().anyMatch(line ->
                            line.source() != null || line.destination() != null || (!"SKU-X".equals(line.item()) && !"SKU-Y".equals(line.item()))))) {
                return result(Code.INVALID_LINES, null, actor);
            }
            var fault = Boolean.TRUE.equals(body.simulatePopFailure()) && original == null
                    ? InMemoryTransferDomain.Fault.AFTER_ERP_COMMIT : InMemoryTransferDomain.Fault.NONE;
            var before = factory.domain.view().activeErpDocuments();
            LocalDate date = businessDate(LocalDateTime.now());
            Reply reply = factory.domain.execute(command, fault);
            if (reply.code() == Code.OK || reply.code() == Code.ERP_COMMITTED_POP_PENDING) {
                // Record dates also when ERP committed and POP must still be replayed.
                var after = factory.domain.view().activeErpDocuments();
                for (DocumentId id : before.keySet()) {
                    if (!after.containsKey(id)) {
                        factory.dates.remove(id.revision());
                        factory.departments.remove(id.revision());
                        factory.workers.remove(id.revision());
                    }
                }
                for (DocumentId id : after.keySet()) {
                    if (!before.containsKey(id)) {
                        factory.dates.put(id.revision(), date);
                        factory.departments.put(id.revision(), identity.worker().department());
                        factory.workers.put(id.revision(), identity.worker().name());
                    }
                }
                factory.actors.putIfAbsent(key, actor);
            }
            return result(reply.code(), reply.transfer(), actor);
        }
    }

    private String receivingPlant(String terminal, String warehouse) {
        String name = master.plantName(terminal, warehouse);
        if (name != null || forms.catalog == null) return name;
        return forms.catalog.warehouses().stream().filter(w -> warehouse.equals(w.code()))
                .flatMap(w -> forms.catalog.sites().stream().filter(site -> site.code().equals(w.plant())))
                .map(TransferFormData.Site::name).findFirst().orElse(null);
    }

    private TransferMaster.Options options(String terminal) {
        var original = master.options(terminal);
        if (forms.catalog == null) return original;
        var warehouses = new java.util.ArrayList<>(original.warehouses());
        for (var w : forms.catalog.warehouses()) {
            if (warehouses.stream().noneMatch(old -> old.PLANT_CODE().equals(w.plant()) && old.WAREHOUSE_CODE().equals(w.code())))
                warehouses.add(new TransferMaster.Warehouse("000001", w.plant(), w.code(), w.name(), w.etc(), "0"));
        }
        return new TransferMaster.Options(original.configured(), original.terminalPlant(), original.plants(), warehouses);
    }
    public record FormLine(String outPlant, String inPlant, String source, String destination,
                           TransferFormData.Spec spec, BigDecimal quantity, String lot, String location, String item) {
        public FormLine {
            if (quantity != null) quantity = quantity.stripTrailingZeros();
        }
    }
    public record FormBody(String key, Action action, List<FormLine> lines, LocalDate date) {}
    public record FormRecord(String number, String erpRequest, LocalDate day, String plant, String worker, List<FormLine> lines) {}
    public record Available(TransferFormData.Lot lot, int remaining) {}
    public record FormView(TransferFormData.Catalog catalog, List<FormRecord> records, List<Available> stock) {}
    private record Entry(Actor actor, FormBody body, String number) {}

    private FormView formView(FactoryTransfers factory, View view) {
        if (forms.catalog == null) return null;
        var records = factory.records.values().stream()
                .filter(r -> view.transfers().get(r.erpRequest()).status() != Status.CANCELLED).toList();
        var lots = forms.catalog.lots().stream().map(lot -> new Available(lot, available(factory, lot))).toList();
        return new FormView(forms.catalog, records, lots);
    }

    private static int available(FactoryTransfers factory, TransferFormData.Lot lot) {
        var total = factory.domain.view().stock().getOrDefault(new StockKey(lot.warehouse(), lot.item()), BigDecimal.ZERO);
        var transfers = factory.domain.view().transfers();
        int allocated = factory.records.values().stream()
                .filter(r -> transfers.get(r.erpRequest()).documents().containsKey(Kind.SHIP))
                .flatMap(r -> r.lines().stream())
                .filter(line -> lot.lot().equals(line.lot()) && lot.location().equals(line.location())
                        && lot.warehouse().equals(line.source()) && lot.item().equals(line.item()))
                .mapToInt(line -> line.quantity().intValueExact()).sum();
        return total.min(BigDecimal.valueOf(lot.quantity() - allocated)).intValue();
    }

    private static ResponseEntity<Failure> reject(int status, String code) {
        return ResponseEntity.status(status).body(new Failure(code));
    }

    @PostMapping(path = "/forms", consumes = "application/json")
    public ResponseEntity<?> registerForm(@RequestBody FormBody body, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        Actor actor = actor(identity);
        String site = master.options(actor.terminalId()).terminalPlant();
        if (forms.catalog == null || site == null) return reject(403, "FORM_NOT_CONFIGURED");
        if (body == null || body.key() == null || body.key().isBlank() || body.lines() == null || body.lines().isEmpty()
                || (body.action() != Action.REQUEST && body.action() != Action.QUICK_TRANSFER))
            return reject(400, "INVALID_COMMAND");
        var factory = factory(identity);
        synchronized (factory) {
            Entry previous = factory.receipts.get(body.key());
            if (previous != null) {
                if (!actor.equals(previous.actor())) return reject(403, "COMMAND_ACTOR_MISMATCH");
                if (!previous.body().equals(body)) return reject(409, "REQUEST_ID_REUSED");
                return ResponseEntity.ok(Map.of("number", previous.number()));
            }
            boolean quick = body.action() == Action.QUICK_TRANSFER;
            LocalDate day = quick ? body.date() : businessDate(LocalDateTime.now());
            if (day == null) return reject(400, "INVALID_DATE");
            var requested = new java.util.ArrayList<Line>();
            var saved = new java.util.ArrayList<FormLine>();
            var allocations = new HashMap<TransferFormData.Lot, Integer>();
            String source = null, destination = null;
            for (FormLine row : body.lines()) {
                if (row == null || row.quantity() == null || row.quantity().scale() > 0 || row.quantity().signum() <= 0
                        || row.quantity().compareTo(BigDecimal.valueOf(Integer.MAX_VALUE)) > 0 || row.spec() == null || !forms.hasWarehouse(row.inPlant(), row.destination()))
                    return reject(422, "INVALID_LINES");
                String from, item;
                if (quick) {
                    if (!forms.hasWarehouse(row.outPlant(), row.source()) || row.source().equals(row.destination()))
                        return reject(422, "INVALID_LINES");
                    if (row.outPlant().equals(row.inPlant())) return reject(422, "WAREHOUSE_TRIGGER_UNVERIFIED");
                    var lot = forms.catalog.lots().stream().filter(l -> l.warehouse().equals(row.source())
                            && l.plant().equals(row.outPlant()) && l.location().equals(row.location())
                            && l.lot().equals(row.lot()) && l.spec().equals(row.spec()) && l.item().equals(row.item())).findFirst().orElse(null);
                    if (lot == null || allocations.containsKey(lot)) return reject(422, "INVALID_LINES");
                    if (row.quantity().intValueExact() > available(factory, lot)) return reject(409, "INSUFFICIENT_STOCK");
                    allocations.put(lot, row.quantity().intValueExact());
                    from = lot.warehouse();
                    item = lot.item();
                } else {
                    var match = forms.resolve(row.outPlant(), row.inPlant(), row.destination(), row.spec());
                    if (match == null) return reject(422, "MATERIAL_NOT_FOUND");
                    from = match.source();
                    item = match.item();
                }
                if (quick && source != null && (!source.equals(from) || !destination.equals(row.destination())))
                    return reject(422, "MULTIPLE_ROUTES_UNSUPPORTED");
                if (source == null) { source = from; destination = row.destination(); }
                requested.add(new Line(requested.size() + 1, item, row.quantity(), from, row.destination()));
                saved.add(new FormLine(row.outPlant(), row.inPlant(), from, row.destination(), row.spec(), row.quantity(), quick ? row.lot() : null, quick ? row.location() : "000000", item));
            }
            int sequence = factory.sequences.getOrDefault(day, 0);
            String number;
            do {
                if (++sequence > 9999) return reject(409, "NUMBER_EXHAUSTED");
                number = day.format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE) + String.format(java.util.Locale.ROOT, "%04d", sequence);
            } while (factory.domain.view().transfers().containsKey(number));
            var view = factory.domain.view();
            String erpRequest = forms.catalog.erpRequestNumbers().stream().filter(n -> !view.transfers().containsKey(n))
                    .findFirst().orElse(null);
            if (erpRequest == null) return reject(422, "ERP_NUMBER_NOT_CONFIGURED");
            var cmd = new Command(erpRequest, body.key(), body.action(), new Draft(source, destination, requested));
            var reply = factory.domain.execute(cmd);
            if (reply.code() != Code.OK) return result(reply.code(), null, actor);
            for (var id : reply.transfer().documents().values()) {
                factory.dates.put(id.revision(), day);
                factory.workers.put(id.revision(), identity.worker().name());
                factory.departments.put(id.revision(), identity.worker().department());
            }
            factory.sequences.put(day, sequence);
            factory.records.put(erpRequest, new FormRecord(number, erpRequest, day, site, identity.worker().name(), List.copyOf(saved)));
            factory.actors.put(key(cmd), actor);
            factory.receipts.put(body.key(), new Entry(actor, body, number));
            return ResponseEntity.ok(Map.of("number", number));
        }
    }

    static LocalDate businessDate(LocalDateTime time) {
        return (time.getHour() < 8 ? time.minusDays(1) : time).toLocalDate();
    }

    public record OutputSelection(List<DocumentId> documents) {}
    public record OutputRow(int number, BigDecimal quantity, String specification, String remark) {}
    public record OutputGroup(String request, LocalDate requestDate, String department, String receivingPlant, String headerRemark, List<OutputRow> rows, BigDecimal total) {}
    public record OutputList(String form, String printerRole, LocalDateTime issuedAt, List<OutputGroup> groups) {}

    @PostMapping(path = "/output-list/preview", consumes = "application/json")
    public ResponseEntity<?> preview(@RequestBody OutputSelection selection, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        var factory = factory(identity);
        if (selection == null || selection.documents() == null || selection.documents().isEmpty())
            return ResponseEntity.badRequest().body(new Failure("NO_OUTPUT_SELECTION"));
        synchronized (factory) {
            View view = factory.domain.view();
            var groups = new LinkedHashMap<String, OutputGroup>();
            for (DocumentId id : selection.documents()) {
                if (id == null || id.kind() != Kind.REQUEST || id.request() == null)
                    return ResponseEntity.badRequest().body(new Failure("INVALID_COMMAND"));
                var transfer = view.transfers().get(id.request());
                var doc = view.activeErpDocuments().get(id);
                if (doc == null || transfer == null
                        || !id.equals(transfer.documents().get(Kind.REQUEST)))
                    return ResponseEntity.status(409).body(new Failure("INVALID_STATE"));
                var rows = doc.lines().stream().map(DocumentLine::line)
                        .map(line -> {
                            var detail = master.reportLine(id.request(), line.number());
                            return new OutputRow(line.number(), line.quantity(), detail == null ? null : detail.STND_ITEM(),
                                    detail == null ? null : detail.DC_RMK());
                        }).toList();
                var total = rows.stream().map(OutputRow::quantity).reduce(BigDecimal.ZERO, BigDecimal::add);
                groups.putIfAbsent(id.request(), new OutputGroup(id.request(), factory.dates.get(id.revision()),
                        factory.departments.get(id.revision()), receivingPlant(identity.terminal().id(), transfer.draft().destination()), master.headerRemark(id.request()), rows, total));
            }
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(
                    new OutputList("rptOutputList", "Printer1", LocalDateTime.now(), List.copyOf(groups.values())));
        }
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Failure> malformed() {
        return ResponseEntity.badRequest().body(new Failure("MALFORMED_COMMAND"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Failure> sessionError(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode())
                .body(new Failure(exception.getStatusCode().value() == 401 ? "LOGIN_REQUIRED" : "REQUEST_FAILED"));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Failure> unexpected(RuntimeException exception) {
        LOG.log(System.Logger.Level.ERROR, "Unexpected transfer demo failure", exception);
        return ResponseEntity.internalServerError().body(new Failure("INTERNAL_ERROR"));
    }

    private FactoryTransfers factory(DemoSessionController.Identity identity) {
        return factories.computeIfAbsent(identity.terminal().factory(), unused -> new FactoryTransfers(forms));
    }

    private static Actor actor(DemoSessionController.Identity identity) {
        return new Actor(identity.terminal().id(), identity.worker().id());
    }

    private static ReplayCommand replay(Command command) {
        Draft draft = command.draft();
        ReplayDraft copy = draft == null ? null : new ReplayDraft(draft.source(), draft.destination(),
                draft.lines().stream().map(line -> new ReplayLine(line.number(), line.item(),
                        line.quantity().toPlainString())).toList());
        return new ReplayCommand(command.request(), command.commandId(), command.action(), copy, command.sourceDocument(), command.autoReceive());
    }

    private static CommandKey key(Command command) {
        return new CommandKey(command.request(), command.commandId());
    }

    private static ResponseEntity<Result> result(Code code, Transfer transfer, Actor actor) {
        int status = switch (code) {
            case OK -> 200;
            case INVALID_COMMAND -> 400;
            case REQUEST_NOT_FOUND -> 404;
            case INVALID_STATE, REQUEST_ID_REUSED, RECONCILIATION_REQUIRED, ERP_DETAIL_MISMATCH, INSUFFICIENT_STOCK, STOCK_OVERFLOW -> 409;
            case INVALID_LINES -> 422;
            case ERP_COMMITTED_POP_PENDING -> 503;
            case FAILED_BEFORE_ERP_COMMIT -> 500;
        };
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore())
                .body(new Result(code.name(), transfer, actor));
    }
}
