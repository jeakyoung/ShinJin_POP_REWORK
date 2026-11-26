package synthetic.transfer;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static synthetic.transfer.TransferDomain.Action.*;
import static synthetic.transfer.TransferDomain.Code.*;

public final class InMemoryTransferDomain implements TransferDomain {
    public enum Fault { NONE, BEFORE_ERP_COMMIT, AFTER_ERP_COMMIT }

    private static final BigDecimal MAX_STOCK = new BigDecimal("999999999999999.999");
    private record Key(String request, String commandId) {}
    private record Operation(Command command, Transfer result, Map<StockKey, BigDecimal> delta,
                             Map<DocumentId, Document> expectedDocuments, long sequence) {}
    private record Erp(Map<DocumentId, Document> documents, Map<Key, Operation> journal, long sequence) {}
    private record Pop(Map<String, Transfer> transfers, Map<StockKey, BigDecimal> stock,
                       Map<Key, Reply> receipts) {}

    private Erp erp = new Erp(Map.of(), Map.of(), 0);
    private Pop pop;

    public InMemoryTransferDomain(Map<StockKey, BigDecimal> initialStock) {
        Map<StockKey, BigDecimal> balances = new HashMap<>();
        initialStock.forEach((key, value) -> {
            if (key == null || blank(key.warehouse()) || blank(key.item()) || !validStock(value)) {
                throw new IllegalArgumentException("Invalid fixture stock");
            }
            balances.put(key, value.setScale(3));
        });
        pop = new Pop(Map.of(), Map.copyOf(balances), Map.of());
    }

    @Override
    public Reply execute(Command command) {
        return execute(command, Fault.NONE);
    }

    public synchronized Reply execute(Command command, Fault fault) {
        Objects.requireNonNull(fault);
        if (command == null || blank(command.request()) || blank(command.commandId())
                || command.action() == null || (!createsRequest(command.action()) && command.draft() != null)) {
            return error(INVALID_COMMAND);
        }

        if ((command.autoReceive() && command.action() != SHIP)
                || (createsRequest(command.action()) && command.sourceDocument() != null)) return error(INVALID_COMMAND);
        Key key = new Key(command.request(), command.commandId());
        Operation existing = erp.journal().get(key);
        if (existing != null) {
            if (!existing.command().equals(command)) return error(REQUEST_ID_REUSED);
            Reply receipt = pop.receipts().get(key);
            if (receipt != null) return receipt;
            if (!documentsFor(key.request()).equals(existing.expectedDocuments())) return error(ERP_DETAIL_MISMATCH);
            if (fault == Fault.AFTER_ERP_COMMIT) return error(ERP_COMMITTED_POP_PENDING);
            return commitPop(key, existing);
        }
        if (pending().containsKey(command.request())) return error(RECONCILIATION_REQUIRED);

        Transfer current = pop.transfers().get(command.request());
        if (createsRequest(command.action())) {
            if (current != null) return error(INVALID_STATE);
            if (!validDraft(command.draft())) return error(INVALID_LINES);
        } else if (current == null) {
            return error(REQUEST_NOT_FOUND);
        } else if (current.status() != requiredState(command.action())) {
            return error(INVALID_STATE);
        }

        if (command.sourceDocument() != null) {
            Kind sourceKind = switch (command.action()) {
                case SHIP, CANCEL_REQUEST -> Kind.REQUEST;
                case RECEIVE, UNDO_SHIP -> Kind.SHIP;
                case UNDO_RECEIVE -> Kind.RECEIVE;
                default -> throw new IllegalStateException("Expected an existing document");
            };
            if (!command.sourceDocument().equals(current.documents().get(sourceKind))) return error(INVALID_STATE);
        }

        Operation operation = command.action() == QUICK_TRANSFER
                ? prepareQuickTransfer(command) : prepare(command, current);
        Code quantityCheck = checkStock(operation.delta());
        if (quantityCheck != OK) return error(quantityCheck);
        if (fault == Fault.BEFORE_ERP_COMMIT) return error(FAILED_BEFORE_ERP_COMMIT);
        commitErp(key, operation);
        if (fault == Fault.AFTER_ERP_COMMIT) return error(ERP_COMMITTED_POP_PENDING);
        return commitPop(key, operation);
    }

    private Operation prepare(Command command, Transfer current) {
        Action action = command.action();
        Draft draft = action == REQUEST ? command.draft() : current.draft();
        Map<Kind, DocumentId> documents = new HashMap<>();
        if (current != null) documents.putAll(current.documents());

        Kind kind = kind(action);
        DocumentId shipment = documents.get(Kind.SHIP);
        boolean creates = action == REQUEST || action == SHIP || action == RECEIVE;
        List<Line> lines = switch (action) {
            case REQUEST, SHIP -> draft.lines();
            case RECEIVE, UNDO_RECEIVE, UNDO_SHIP -> erp.documents().get(shipment).lines().stream()
                    .map(DocumentLine::line).toList();
            case CANCEL_REQUEST -> List.of();
            case QUICK_TRANSFER -> throw new IllegalArgumentException("Use batch preparation");
        };

        Map<DocumentId, Document> expected = documentsFor(command.request());
        long sequence = erp.sequence();
        if (creates) {
            DocumentId id = new DocumentId(command.request(), kind, ++sequence);
            DocumentId source = switch (action) {
                case RECEIVE -> shipment;
                case SHIP -> documents.get(Kind.REQUEST);
                default -> null;
            };
            expected.put(id, document(id, lines, source));
            documents.put(kind, id);
        } else {
            expected.remove(documents.remove(kind));
        }

        Map<StockKey, BigDecimal> delta = new HashMap<>();
        switch (action) {
            case SHIP -> addDelta(delta, draft.source(), lines, -1, false);
            case RECEIVE -> addDelta(delta, draft.destination(), lines, 1, true);
            case UNDO_RECEIVE -> addDelta(delta, draft.destination(), lines, -1, true);
            case UNDO_SHIP -> addDelta(delta, draft.source(), lines, 1, false);
            case REQUEST, CANCEL_REQUEST -> { }
            case QUICK_TRANSFER -> throw new IllegalArgumentException("Use batch preparation");
        }
        Status status = nextState(action);
        if (command.autoReceive()) {
            DocumentId receipt = new DocumentId(command.request(), Kind.RECEIVE, ++sequence);
            expected.put(receipt, document(receipt, lines, documents.get(Kind.SHIP)));
            documents.put(Kind.RECEIVE, receipt);
            addDelta(delta, draft.destination(), lines, 1, true);
            status = Status.RECEIVED;
        }
        Transfer result = new Transfer(command.request(), status, draft, documents);
        return new Operation(command, result, Map.copyOf(delta), Map.copyOf(expected), sequence);
    }

    private Operation prepareQuickTransfer(Command command) {
        Draft draft = command.draft();
        long sequence = erp.sequence();
        DocumentId request = new DocumentId(command.request(), Kind.REQUEST, ++sequence);
        DocumentId ship = new DocumentId(command.request(), Kind.SHIP, ++sequence);
        DocumentId receipt = new DocumentId(command.request(), Kind.RECEIVE, ++sequence);
        Map<DocumentId, Document> expected = Map.of(
                request, document(request, draft.lines(), null),
                ship, document(ship, draft.lines(), request),
                receipt, document(receipt, draft.lines(), ship));
        Transfer result = new Transfer(command.request(), Status.RECEIVED, draft,
                Map.of(Kind.REQUEST, request, Kind.SHIP, ship, Kind.RECEIVE, receipt));
        Map<StockKey, BigDecimal> delta = new HashMap<>();
        addDelta(delta, draft.source(), draft.lines(), -1, false);
        addDelta(delta, draft.destination(), draft.lines(), 1, true);
        return new Operation(command, result, Map.copyOf(delta), expected, sequence);
    }

    private static Document document(DocumentId id, List<Line> lines, DocumentId source) {
        return new Document(id, lines.stream().map(line ->
                new DocumentLine(line, source, source == null ? null : line.number())).toList());
    }

    private Map<DocumentId, Document> documentsFor(String request) {
        Map<DocumentId, Document> result = new HashMap<>();
        erp.documents().forEach((id, document) -> {
            if (id.request().equals(request)) result.put(id, document);
        });
        return result;
    }

    // Package-local fault boundary for the pure Java harness.
    synchronized void replacePendingDocumentForTest(Document replacement) {
        DocumentId id = replacement.id();
        if (!pending().containsKey(id.request()) || !erp.documents().containsKey(id)) {
            throw new IllegalArgumentException("Expected an active document with a pending operation");
        }
        Map<DocumentId, Document> documents = new HashMap<>(erp.documents());
        documents.put(id, replacement);
        erp = new Erp(Map.copyOf(documents), erp.journal(), erp.sequence());
    }

    private Code checkStock(Map<StockKey, BigDecimal> delta) {
        List<Operation> reservations = pending().values().stream().toList();
        for (var entry : delta.entrySet()) {
            BigDecimal change = entry.getValue();
            BigDecimal balance = pop.stock().getOrDefault(entry.getKey(), BigDecimal.ZERO);
            for (Operation pending : reservations) {
                BigDecimal reserved = pending.delta().getOrDefault(entry.getKey(), BigDecimal.ZERO);
                if (reserved.signum() == change.signum()) balance = balance.add(reserved);
            }
            BigDecimal result = balance.add(change);
            if (result.signum() < 0) return INSUFFICIENT_STOCK;
            if (result.compareTo(MAX_STOCK) > 0) return STOCK_OVERFLOW;
        }
        return OK;
    }

    private void commitErp(Key key, Operation operation) {
        Map<DocumentId, Document> documents = new HashMap<>(erp.documents());
        documents.keySet().removeIf(id -> id.request().equals(key.request()));
        documents.putAll(operation.expectedDocuments());
        Map<Key, Operation> journal = new HashMap<>(erp.journal());
        journal.put(key, operation);
        erp = new Erp(Map.copyOf(documents), Map.copyOf(journal), operation.sequence());
    }

    private Reply commitPop(Key key, Operation operation) {
        Map<StockKey, BigDecimal> stock = new HashMap<>(pop.stock());
        operation.delta().forEach((item, delta) -> stock.merge(item, delta, BigDecimal::add));
        Map<String, Transfer> transfers = new HashMap<>(pop.transfers());
        transfers.put(key.request(), operation.result());
        Reply reply = new Reply(OK, operation.result());
        Map<Key, Reply> receipts = new HashMap<>(pop.receipts());
        receipts.put(key, reply);
        pop = new Pop(Map.copyOf(transfers), Map.copyOf(stock), Map.copyOf(receipts));
        return reply;
    }

    @Override
    public synchronized View view() {
        Map<String, Command> commands = new HashMap<>();
        pending().forEach((request, operation) -> commands.put(request, operation.command()));
        return new View(pop.transfers(), pop.stock(), erp.documents(), commands);
    }

    private Map<String, Operation> pending() {
        Map<String, Operation> result = new HashMap<>();
        erp.journal().forEach((key, operation) -> {
            if (!pop.receipts().containsKey(key)) result.put(key.request(), operation);
        });
        return result;
    }

    private static void addDelta(Map<StockKey, BigDecimal> delta, String warehouse, List<Line> lines, int sign, boolean inbound) {
        for (Line line : lines) {
            BigDecimal qty = sign < 0 ? line.quantity().negate() : line.quantity();
            String location = inbound ? line.destination() : line.source();
            delta.merge(new StockKey(location == null ? warehouse : location, line.item()), qty, BigDecimal::add);
        }
    }

    private static Status requiredState(Action action) {
        return switch (action) {
            case SHIP, CANCEL_REQUEST -> Status.REQUESTED;
            case RECEIVE, UNDO_SHIP -> Status.SHIPPED;
            case UNDO_RECEIVE -> Status.RECEIVED;
            case REQUEST, QUICK_TRANSFER -> throw new IllegalArgumentException("Request has no predecessor");
        };
    }

    private static Status nextState(Action action) {
        return switch (action) {
            case REQUEST, UNDO_SHIP -> Status.REQUESTED;
            case SHIP, UNDO_RECEIVE -> Status.SHIPPED;
            case RECEIVE, QUICK_TRANSFER -> Status.RECEIVED;
            case CANCEL_REQUEST -> Status.CANCELLED;
        };
    }

    private static Kind kind(Action action) {
        return switch (action) {
            case REQUEST, CANCEL_REQUEST -> Kind.REQUEST;
            case SHIP, UNDO_SHIP -> Kind.SHIP;
            case RECEIVE, UNDO_RECEIVE -> Kind.RECEIVE;
            case QUICK_TRANSFER -> throw new IllegalArgumentException("Batch has multiple document kinds");
        };
    }

    private static boolean createsRequest(Action action) {
        return action == REQUEST || action == QUICK_TRANSFER;
    }

    private static boolean validDraft(Draft draft) {
        if (draft == null || blank(draft.source()) || blank(draft.destination())
                || draft.source().equals(draft.destination()) || draft.lines().isEmpty()) return false;
        var numbers = new HashSet<Integer>();
        for (Line line : draft.lines()) {
            if ((line.source() != null || line.destination() != null)
                    && (blank(line.source()) || blank(line.destination()) || line.source().equals(line.destination()))) return false;
            if (line.number() <= 0 || !numbers.add(line.number()) || blank(line.item())
                    || !validStock(line.quantity()) || line.quantity().signum() == 0) return false;
        }
        return true;
    }

    private static boolean validStock(BigDecimal qty) {
        return qty != null && qty.scale() <= 3 && qty.signum() >= 0 && qty.compareTo(MAX_STOCK) <= 0;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static Reply error(Code code) {
        return new Reply(code, null);
    }
}
