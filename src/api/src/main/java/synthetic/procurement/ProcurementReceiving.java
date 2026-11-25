package synthetic.procurement;

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
import java.util.TreeMap;

public final class ProcurementReceiving {
    public enum SourceType { ESCO_SHIPMENT, PURCHASE_ORDER }
    public enum Status { OPEN, PARTIALLY_RECEIVED, RECEIVED }

    public record Actor(String terminalId, String workerId) {}
    public record SourceKey(SourceType type, String number) {}
    public record LineSeed(int lineNo, String item, String warehouse, BigDecimal expected) {}
    public record SourceSeed(String terminalId, SourceKey key, LocalDate sourceDate, List<LineSeed> lines) {}
    public record Line(int lineNo, String item, String warehouse, BigDecimal expected,
                       BigDecimal received, BigDecimal remaining) {}
    public record SourceView(SourceKey source, LocalDate sourceDate, Status status, long revision,
                             List<Line> lines, List<Receipt> receipts) {}
    public record Selection(int lineNo, BigDecimal quantity) {}
    public record Command(String requestId, long expectedRevision, List<Selection> lines) {}
    public record ReceiptLine(int lineNo, String item, String warehouse, BigDecimal quantity, BigDecimal remaining) {}
    public record Receipt(String receiptId, SourceKey source, String terminalId, String workerId, Instant recordedAt,
                          long revision, List<ReceiptLine> lines) {}
    public record Balance(String warehouse, String item, BigDecimal quantity) {}
    public record Reply<T>(int status, String code, T value) {}

    private record ScopedSource(String terminalId, SourceKey source) {}
    private record StockKey(String terminalId, String warehouse, String item) {}
    private record RequestKey(String terminalId, String requestId) {}
    private record Replay(String workerId, ScopedSource source, Command command, Receipt receipt) {}
    private record Source(LocalDate date, long revision, List<Line> lines, List<Receipt> receipts) {}
    private record State(Map<ScopedSource, Source> sources, Map<StockKey, BigDecimal> stock,
                         Map<RequestKey, Replay> replays) {}

    private static final BigDecimal ZERO = new BigDecimal("0.000");
    private final Clock clock;
    private State state;

    public ProcurementReceiving(Clock clock, List<SourceSeed> seeds) {
        this.clock = Objects.requireNonNull(clock);
        var sources = new HashMap<ScopedSource, Source>();
        var stock = new HashMap<StockKey, BigDecimal>();
        for (var seed : seeds) {
            if (!present(seed.terminalId()) || !validSource(seed.key())
                    || seed.sourceDate() == null || seed.lines() == null || seed.lines().isEmpty()) {
                throw new IllegalArgumentException("Invalid synthetic source");
            }
            var lines = new TreeMap<Integer, Line>();
            for (var row : seed.lines()) {
                if (row.lineNo() < 1 || !present(row.item()) || !present(row.warehouse()) || !validQuantity(row.expected())) {
                    throw new IllegalArgumentException("Invalid synthetic line");
                }
                var expected = row.expected().setScale(3);
                if (lines.putIfAbsent(row.lineNo(), new Line(row.lineNo(), row.item(), row.warehouse(), expected, ZERO, expected)) != null) {
                    throw new IllegalArgumentException("Duplicate synthetic line");
                }
                stock.put(new StockKey(seed.terminalId(), row.warehouse(), row.item()), ZERO);
            }
            if (sources.putIfAbsent(new ScopedSource(seed.terminalId(), seed.key()),
                    new Source(seed.sourceDate(), 0, List.copyOf(lines.values()), List.of())) != null) {
                throw new IllegalArgumentException("Duplicate synthetic source");
            }
        }
        state = new State(Map.copyOf(sources), Map.copyOf(stock), Map.of());
    }

    public synchronized Reply<List<SourceView>> list(Actor actor, SourceType type, String number, LocalDate date) {
        if (!validActor(actor)) return error(401, "LOGIN_REQUIRED");
        if (type == null || number != null && !validNumber(number)) return error(422, "INVALID_SOURCE");
        return ok(state.sources().entrySet().stream()
                .filter(entry -> entry.getKey().terminalId().equals(actor.terminalId())
                        && entry.getKey().source().type() == type
                        && (number == null || entry.getKey().source().number().equals(number))
                        && (date == null || entry.getValue().date().equals(date)))
                .sorted(Comparator.comparing(entry -> entry.getKey().source().number()))
                .map(entry -> view(entry.getKey().source(), entry.getValue())).toList());
    }

    public synchronized Reply<SourceView> get(Actor actor, SourceKey key) {
        if (!validActor(actor)) return error(401, "LOGIN_REQUIRED");
        if (!validSource(key)) return error(422, "INVALID_SOURCE");
        var source = state.sources().get(new ScopedSource(actor.terminalId(), key));
        return source == null ? error(404, "SOURCE_NOT_FOUND") : ok(view(key, source));
    }

    public synchronized Reply<List<Balance>> balances(Actor actor) {
        if (!validActor(actor)) return error(401, "LOGIN_REQUIRED");
        return ok(state.stock().entrySet().stream()
                .filter(entry -> entry.getKey().terminalId().equals(actor.terminalId()))
                .sorted(Map.Entry.comparingByKey(Comparator.comparing(StockKey::warehouse).thenComparing(StockKey::item)))
                .map(entry -> new Balance(entry.getKey().warehouse(), entry.getKey().item(), entry.getValue()))
                .toList());
    }

    public synchronized Reply<Receipt> receive(Actor actor, SourceKey key, Command command) {
        if (!validActor(actor)) return error(401, "LOGIN_REQUIRED");
        if (!validSource(key)) return error(422, "INVALID_SOURCE");
        var scope = new ScopedSource(actor.terminalId(), key);
        var source = state.sources().get(scope);
        if (source == null) return error(404, "SOURCE_NOT_FOUND");
        if (command == null || command.requestId() == null || !command.requestId().matches("[a-zA-Z0-9_-]{1,64}")
                || command.expectedRevision() < 0) return error(422, "INVALID_COMMAND");

        var request = new RequestKey(actor.terminalId(), command.requestId());
        var replay = state.replays().get(request);
        if (replay != null && !replay.workerId().equals(actor.workerId())) return error(403, "REQUEST_ACTOR_MISMATCH");
        if (command.lines() == null || command.lines().isEmpty()) return error(422, "LINES_REQUIRED");
        var selections = new TreeMap<Integer, Selection>();
        for (var row : command.lines()) {
            if (row == null || row.lineNo() < 1 || !validQuantity(row.quantity())) return error(422, "INVALID_LINE");
            if (selections.putIfAbsent(row.lineNo(), new Selection(row.lineNo(), row.quantity().setScale(3))) != null) {
                return error(422, "DUPLICATE_LINE");
            }
        }
        var normalized = new Command(command.requestId(), command.expectedRevision(), List.copyOf(selections.values()));
        if (replay != null) {
            return replay.source().equals(scope) && replay.command().equals(normalized)
                    ? ok(replay.receipt()) : error(409, "REQUEST_ID_REUSED");
        }
        if (command.expectedRevision() != source.revision()) return error(409, "STALE_REVISION");

        var lines = new LinkedHashMap<Integer, Line>();
        source.lines().forEach(row -> lines.put(row.lineNo(), row));
        var stock = new HashMap<>(state.stock());
        var movements = new ArrayList<ReceiptLine>();
        for (var selection : selections.values()) {
            var line = lines.get(selection.lineNo());
            if (line == null) return error(422, "LINE_NOT_FOUND");
            var amount = selection.quantity();
            if (line.remaining().signum() == 0) return error(409, "LINE_ALREADY_RECEIVED");
            if (amount.compareTo(line.remaining()) > 0) return error(409, "QUANTITY_EXCEEDS_REMAINING");
            var remaining = line.remaining().subtract(amount);
            lines.put(line.lineNo(), new Line(line.lineNo(), line.item(), line.warehouse(),
                    line.expected(), line.received().add(amount), remaining));
            stock.merge(new StockKey(actor.terminalId(), line.warehouse(), line.item()), amount, BigDecimal::add);
            movements.add(new ReceiptLine(line.lineNo(), line.item(), line.warehouse(), amount, remaining));
        }
        long revision = source.revision() + 1;
        var receipt = new Receipt("SYN-RCV-" + actor.terminalId() + "-" + command.requestId(), key,
                actor.terminalId(), actor.workerId(), clock.instant(), revision, List.copyOf(movements));
        var history = new ArrayList<>(source.receipts());
        history.add(receipt);
        var sources = new HashMap<>(state.sources());
        sources.put(scope, new Source(source.date(), revision, List.copyOf(lines.values()), List.copyOf(history)));
        var replays = new HashMap<>(state.replays());
        replays.put(request, new Replay(actor.workerId(), scope, normalized, receipt));
        state = new State(Map.copyOf(sources), Map.copyOf(stock), Map.copyOf(replays));
        return ok(receipt);
    }

    private static SourceView view(SourceKey key, Source source) {
        var lines = source.lines();
        var status = lines.stream().allMatch(row -> row.remaining().signum() == 0) ? Status.RECEIVED
                : source.receipts().isEmpty() ? Status.OPEN : Status.PARTIALLY_RECEIVED;
        return new SourceView(key, source.date(), status, source.revision(), lines, source.receipts());
    }

    private static boolean validActor(Actor actor) {
        return actor != null && present(actor.terminalId()) && present(actor.workerId());
    }

    private static boolean validSource(SourceKey key) {
        return key != null && key.type() != null && validNumber(key.number());
    }

    private static boolean validNumber(String number) {
        return number != null && number.matches("[a-zA-Z0-9][a-zA-Z0-9-]{0,39}");
    }

    private static boolean present(String value) { return value != null && !value.isBlank(); }

    private static boolean validQuantity(BigDecimal value) {
        return value != null && value.signum() > 0 && value.scale() >= -18 && value.scale() <= 64
                && value.precision() <= 64 && value.precision() - value.scale() <= 15
                && value.stripTrailingZeros().scale() <= 3;
    }

    private static <T> Reply<T> ok(T value) { return new Reply<>(200, null, value); }

    private static <T> Reply<T> error(int status, String code) { return new Reply<>(status, code, null); }
}
