package synthetic.management;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class ManagementDemo {
    public enum Origin { CATALOG, RECENT }
    public enum RepairStatus { ALL, COMPLETE, OPEN }

    public record Site(String factory, String plant) {}
    public record Actor(Site site, String workplace, String terminal, String worker) {}
    public record StockKey(String item, String lot, String warehouse, String location) {}
    public record Stock(Site site, StockKey key, String name, String materialFlag, String kind1, String kind2, int available) {}
    public record Catalog(long revision, List<Stock> rows) {}
    public record Selection(Origin origin, String priorRequest, StockKey stock, BigDecimal quantity) {}
    public record Command(String requestId, Long expectedRevision, List<Selection> lines) {}
    public record Movement(String movementId, Origin origin, String priorRequest, StockKey stock, int quantity) {}
    public record Receipt(String number, Actor actor, Instant recordedAt, long revision, List<Movement> lines) {}
    public record PriorLine(String request, StockKey stock, String name, int issued, int available) {}
    public record Recent(long revision, List<PriorLine> rows) {}
    public record Repair(Site site, String issue, String equipment, String reason, LocalDate opened,
                         LocalDate closed, String result) {}
    public record RepairView(LocalDate from, LocalDate to, List<Repair> rows) {}
    public record Reply<T>(int status, String code, T value) {}

    public record ReturnSelection(String issue, String movementId, BigDecimal quantity) {}
    public record ReturnCommand(String requestId, Long expectedRevision, List<ReturnSelection> lines) {}
    public record ReturnLine(String issue, String movementId, StockKey stock, int issued, int returned, int remaining) {}
    public record Returned(String issue, String movementId, StockKey stock, int quantity) {}
    public record ReturnReceipt(String number, Actor actor, Instant recordedAt, long revision, List<Returned> lines) {}
    public record ReturnView(long revision, List<ReturnLine> rows, List<ReturnReceipt> history) {}
    private record ReturnKey(String issue, String movementId) {}
    private record StoredReturn(Actor actor, ReturnCommand command, ReturnReceipt receipt) {}
    private record Returns(Map<ReturnKey, Integer> totals, Map<RequestKey, StoredReturn> requests,
                           List<ReturnReceipt> history) {}

    private record ScopedStock(Site site, StockKey key) {}
    private record RequestKey(String terminal, String requestId) {}
    private record Stored(Actor actor, Command command, Receipt receipt) {}
    private record State(Map<ScopedStock, Stock> stocks, Map<Site, Long> revisions,
                         Map<RequestKey, Stored> requests, List<Receipt> history, Returns returns) {}

    private static final Comparator<StockKey> STOCK_ORDER = Comparator.comparing(StockKey::item)
            .thenComparing(StockKey::lot).thenComparing(StockKey::warehouse).thenComparing(StockKey::location);
    private static final Comparator<Selection> SELECTION_ORDER = Comparator.comparing(Selection::stock, STOCK_ORDER)
            .thenComparing(Selection::origin).thenComparing(Selection::priorRequest, Comparator.nullsFirst(String::compareTo));

    private final Clock clock;
    private final List<Repair> repairs;
    private State state;

    public ManagementDemo(Clock clock, List<Stock> catalog, List<Repair> repairs) {
        this.clock = Objects.requireNonNull(clock);
        this.repairs = List.copyOf(repairs);
        var stocks = new HashMap<ScopedStock, Stock>();
        for (var row : catalog) {
            if (row.available() < 0 || stocks.putIfAbsent(new ScopedStock(row.site(), row.key()), row) != null) {
                throw new IllegalArgumentException("Invalid stock fixture");
            }
        }
        state = new State(Map.copyOf(stocks), Map.of(), Map.of(), List.of(), new Returns(Map.of(), Map.of(), List.of()));
    }

    public synchronized Reply<Catalog> catalog(Actor actor, String materialFlag, String kind1, String kind2) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        var rows = state.stocks().values().stream()
                .filter(row -> row.site().equals(actor.site()) && matches(materialFlag, row.materialFlag())
                        && matches(kind1, row.kind1()) && matches(kind2, row.kind2()))
                .sorted(Comparator.comparing(Stock::key, STOCK_ORDER)).toList();
        return ok(new Catalog(revision(actor.site()), rows));
    }

    public synchronized Reply<Recent> recent(Actor actor) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        var rows = state.history().stream().filter(receipt -> workplace(actor, receipt) && recent(receipt))
                .flatMap(receipt -> {
                    var issued = new LinkedHashMap<StockKey, Integer>();
                    receipt.lines().forEach(line -> issued.merge(line.stock(), line.quantity(), Integer::sum));
                    return issued.entrySet().stream().map(entry -> {
                        var stock = state.stocks().get(new ScopedStock(actor.site(), entry.getKey()));
                        return new PriorLine(receipt.number(), entry.getKey(), stock.name(), entry.getValue(), stock.available());
                    });
                }).toList();
        return ok(new Recent(revision(actor.site()), rows));
    }

    public synchronized Reply<List<Receipt>> history(Actor actor) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        return ok(state.history().stream().filter(row -> workplace(actor, row)).toList());
    }

    public Reply<RepairView> repairs(Actor actor, LocalDate from, LocalDate to, RepairStatus status) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        var end = to == null ? LocalDate.now(clock) : to;
        var start = from == null ? end.minusMonths(1) : from;
        if (start.isAfter(end) || status == null) return error(422, "INVALID_REPAIR_FILTER");
        return ok(new RepairView(start, end, repairs.stream().filter(row -> row.site().equals(actor.site())
                && !row.opened().isBefore(start) && !row.opened().isAfter(end)
                && (status == RepairStatus.ALL || (row.closed() != null) == (status == RepairStatus.COMPLETE)))
                .sorted(Comparator.comparing(Repair::opened).thenComparing(Repair::issue)).toList()));
    }

    public synchronized Reply<Receipt> issue(Actor actor, Command command) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        if (command == null || !present(command.requestId()) || !command.requestId().matches("[A-Za-z0-9_-]{1,64}")
                || command.expectedRevision() == null || command.expectedRevision() < 0) return error(422, "INVALID_COMMAND");
        if (command.lines() == null || command.lines().isEmpty() || command.lines().size() > 100) {
            return error(422, "LINES_REQUIRED");
        }
        var key = new RequestKey(actor.terminal(), command.requestId());
        var prior = state.requests().get(key);
        if (prior != null && !prior.actor().equals(actor)) return error(403, "REQUEST_ACTOR_MISMATCH");
        var lines = new ArrayList<Selection>();
        for (var line : command.lines()) {
            if (line == null || line.origin() == null || !valid(line.stock()) || !whole(line.quantity())
                    || (line.origin() == Origin.RECENT ? !present(line.priorRequest()) : line.priorRequest() != null)) {
                return error(422, "INVALID_LINE");
            }
            lines.add(new Selection(line.origin(), line.priorRequest(), line.stock(), line.quantity().setScale(0)));
        }
        lines.sort(SELECTION_ORDER);
        for (int i = 1; i < lines.size(); i++) {
            if (SELECTION_ORDER.compare(lines.get(i - 1), lines.get(i)) == 0) return error(422, "DUPLICATE_LINE");
        }
        var normalized = new Command(command.requestId(), command.expectedRevision(), List.copyOf(lines));
        if (prior != null) return prior.command().equals(normalized)
                ? ok(prior.receipt()) : error(409, "REQUEST_ID_REUSED");
        long revision = revision(actor.site());
        if (command.expectedRevision() != revision) return error(409, "STALE_REVISION");

        var working = new HashMap<>(state.stocks());
        var movements = new ArrayList<Movement>();
        var number = "SYN-M1-" + actor.terminal() + "-" + command.requestId();
        for (var line : lines) {
            var stockKey = new ScopedStock(actor.site(), line.stock());
            var row = working.get(stockKey);
            if (row == null) return error(404, "STOCK_NOT_FOUND");
            if (line.origin() == Origin.RECENT && state.history().stream().noneMatch(receipt ->
                    receipt.number().equals(line.priorRequest()) && workplace(actor, receipt) && recent(receipt)
                    && receipt.lines().stream().anyMatch(original -> original.stock().equals(line.stock())))) {
                return error(404, "RECENT_REQUEST_NOT_FOUND");
            }
            int amount = line.quantity().intValueExact();
            if (amount > row.available()) return error(409, "STOCK_EXCEEDED");
            working.put(stockKey, new Stock(row.site(), row.key(), row.name(), row.materialFlag(), row.kind1(),
                    row.kind2(), row.available() - amount));
            movements.add(new Movement(number + "-" + (movements.size() + 1), line.origin(),
                    line.priorRequest(), line.stock(), amount));
        }
        var receipt = new Receipt(number, actor, clock.instant(), revision + 1, List.copyOf(movements));
        var requests = new HashMap<>(state.requests());
        requests.put(key, new Stored(actor, normalized, receipt));
        var revisions = new HashMap<>(state.revisions());
        revisions.put(actor.site(), revision + 1);
        var history = new ArrayList<>(state.history());
        history.add(receipt);
        state = new State(Map.copyOf(working), Map.copyOf(revisions), Map.copyOf(requests), List.copyOf(history), state.returns());
        return ok(receipt);
    }

    public synchronized Reply<ReturnView> returnView(Actor actor) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        var returned = state.returns();
        var rows = state.history().stream().filter(receipt -> workplace(actor, receipt))
                .flatMap(receipt -> receipt.lines().stream().map(line -> {
                    int total = returned.totals().getOrDefault(new ReturnKey(receipt.number(), line.movementId()), 0);
                    return new ReturnLine(receipt.number(), line.movementId(), line.stock(),
                            line.quantity(), total, line.quantity() - total);
                })).toList();
        return ok(new ReturnView(revision(actor.site()), rows, returned.history().stream()
                .filter(row -> actor.site().equals(row.actor().site())
                        && actor.workplace().equals(row.actor().workplace())).toList()));
    }

    public synchronized Reply<ReturnReceipt> returnStock(Actor actor, ReturnCommand command) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        if (command == null || !present(command.requestId()) || !command.requestId().matches("[A-Za-z0-9_-]{1,64}")
                || command.expectedRevision() == null || command.expectedRevision() < 0) return error(422, "INVALID_COMMAND");
        if (command.lines() == null || command.lines().isEmpty() || command.lines().size() > 100) {
            return error(422, "LINES_REQUIRED");
        }
        var current = state.returns();
        var key = new RequestKey(actor.terminal(), command.requestId());
        var replay = current.requests().get(key);
        if (replay != null && !replay.actor().equals(actor)) return error(403, "REQUEST_ACTOR_MISMATCH");
        var lines = new ArrayList<ReturnSelection>();
        var seen = new java.util.HashSet<ReturnKey>();
        for (var line : command.lines()) {
            if (line == null || !present(line.issue()) || !present(line.movementId()) || !whole(line.quantity())) {
                return error(422, "INVALID_LINE");
            }
            if (!seen.add(new ReturnKey(line.issue(), line.movementId()))) return error(422, "DUPLICATE_LINE");
            lines.add(new ReturnSelection(line.issue(), line.movementId(), line.quantity().setScale(0)));
        }
        lines.sort(Comparator.comparing(ReturnSelection::issue).thenComparing(ReturnSelection::movementId));
        var normalized = new ReturnCommand(command.requestId(), command.expectedRevision(), List.copyOf(lines));
        if (replay != null) return replay.command().equals(normalized)
                ? ok(replay.receipt()) : error(409, "REQUEST_ID_REUSED");
        long revision = revision(actor.site());
        if (command.expectedRevision() != revision) return error(409, "STALE_REVISION");

        var working = new HashMap<>(state.stocks());
        var totals = new HashMap<>(current.totals());
        var returnedLines = new ArrayList<Returned>();
        for (var selection : lines) {
            var issue = state.history().stream().filter(row -> row.number().equals(selection.issue()) && workplace(actor, row))
                    .findFirst().orElse(null);
            if (issue == null) return error(404, "ISSUE_NOT_FOUND");
            var source = issue.lines().stream().filter(row -> row.movementId().equals(selection.movementId()))
                    .findFirst().orElse(null);
            if (source == null) return error(404, "ISSUE_LINE_NOT_FOUND");
            int amount = selection.quantity().intValueExact();
            var ref = new ReturnKey(issue.number(), source.movementId());
            int already = totals.getOrDefault(ref, 0);
            if (amount > source.quantity() - already) return error(409, "RETURN_EXCEEDS_REMAINING");
            var stockKey = new ScopedStock(actor.site(), source.stock());
            var stock = working.get(stockKey);
            if (amount > Integer.MAX_VALUE - stock.available()) return error(409, "STOCK_OVERFLOW");
            working.put(stockKey, new Stock(stock.site(), stock.key(), stock.name(), stock.materialFlag(),
                    stock.kind1(), stock.kind2(), stock.available() + amount));
            totals.put(ref, already + amount);
            returnedLines.add(new Returned(issue.number(), source.movementId(), source.stock(), amount));
        }
        var receipt = new ReturnReceipt("SYN-M1-RETURN-" + actor.terminal() + "-" + command.requestId(),
                actor, clock.instant(), revision + 1, List.copyOf(returnedLines));
        var receipts = new ArrayList<>(current.history());
        receipts.add(receipt);
        var requests = new HashMap<>(current.requests());
        requests.put(key, new StoredReturn(actor, normalized, receipt));
        var revisions = new HashMap<>(state.revisions());
        revisions.put(actor.site(), revision + 1);
        var returns = new Returns(Map.copyOf(totals), Map.copyOf(requests), List.copyOf(receipts));
        state = new State(Map.copyOf(working), Map.copyOf(revisions), state.requests(), state.history(), returns);
        return ok(receipt);
    }

    private long revision(Site site) { return state.revisions().getOrDefault(site, 0L); }

    private boolean recent(Receipt receipt) {
        return !receipt.recordedAt().atZone(clock.getZone()).toLocalDate().isBefore(LocalDate.now(clock).minusMonths(1));
    }

    private static boolean workplace(Actor actor, Receipt receipt) {
        return actor.site().equals(receipt.actor().site()) && actor.workplace().equals(receipt.actor().workplace());
    }

    private static boolean matches(String filter, String actual) { return filter == null || filter.equals(actual); }

    private static boolean valid(Actor actor) {
        return actor != null && actor.site() != null && present(actor.site().factory()) && present(actor.site().plant())
                && present(actor.workplace()) && present(actor.terminal()) && present(actor.worker());
    }

    private static boolean valid(StockKey key) {
        return key != null && present(key.item()) && present(key.lot()) && present(key.warehouse()) && present(key.location());
    }

    private static boolean whole(BigDecimal value) {
        return value != null && value.signum() > 0 && value.scale() >= -8 && value.scale() <= 16
                && value.precision() <= 24 && value.stripTrailingZeros().scale() <= 0
                && value.compareTo(BigDecimal.valueOf(Integer.MAX_VALUE)) <= 0;
    }

    private static boolean present(String value) { return value != null && !value.isBlank(); }

    private static <T> Reply<T> ok(T value) { return new Reply<>(200, null, value); }
    private static <T> Reply<T> error(int status, String code) { return new Reply<>(status, code, null); }
}
