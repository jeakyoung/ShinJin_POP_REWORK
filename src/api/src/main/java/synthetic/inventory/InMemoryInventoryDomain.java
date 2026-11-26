package synthetic.inventory;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

public final class InMemoryInventoryDomain implements InventoryDomain {
    private static final BigDecimal ZERO = new BigDecimal("0.000");
    private static final BigDecimal MAX = new BigDecimal("999999999999999.999");
    private static final Comparator<Location> LOCATION_ORDER =
            Comparator.comparing(Location::warehouse).thenComparing(Location::position);

    private record Receipt(Actor actor, Command command, Result result) {}
    private record DocumentReceipt(Actor actor, DocumentCommand command, DocumentResult result) {}
    private record Route(Lot lot, Location source, Location destination, BigDecimal quantity) {}

    private static final class Ledger {
        final Map<String, TerminalAccess> terminals;
        final Map<StockKey, BigDecimal> stock = new HashMap<>();
        final Map<String, Movement> movements = new LinkedHashMap<>();
        final Map<String, Receipt> receipts = new HashMap<>();
        final Map<String, DocumentHeader> documents = new LinkedHashMap<>();
        final Map<String, DocumentReceipt> documentReceipts = new HashMap<>();
        long version;

        Ledger(Seed seed) {
            terminals = seed.terminals();
            Set<Location> locations = terminals.values().stream().flatMap(access -> access.locations().stream())
                    .collect(Collectors.toUnmodifiableSet());
            if (locations.stream().anyMatch(location -> !valid(location))) {
                throw new IllegalArgumentException("Invalid inventory fixture location");
            }
            seed.stock().forEach((key, quantity) -> {
                if (!valid(key.lot()) || !locations.contains(key.location()) || !validQuantity(quantity)
                        || quantity.signum() < 0) {
                    throw new IllegalArgumentException("Invalid inventory fixture balance");
                }
                stock.put(key, quantity.setScale(3));
            });
        }

        BigDecimal balance(StockKey key) {
            return stock.getOrDefault(key, ZERO);
        }

        Ledger(Ledger source) {
            terminals = source.terminals;
            stock.putAll(source.stock);
            movements.putAll(source.movements);
        }
    }

    private final Clock clock;
    private final Map<Site, Ledger> ledgers = new HashMap<>();
    private long nextNumber = 1;
    private final Map<String, Integer> dayNumbers = new HashMap<>();

    public InMemoryInventoryDomain(Clock clock, Map<Site, Seed> seeds) {
        this.clock = Objects.requireNonNull(clock);
        seeds.forEach((site, seed) -> ledgers.put(site, new Ledger(seed)));
    }

    @Override
    public synchronized Reply<View> view(Actor actor) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.site());
        TerminalAccess access = access(ledger, actor);
        if (access == null) return error(403, "TERMINAL_OUT_OF_SCOPE");
        var locations = access.locations().stream().sorted(LOCATION_ORDER).toList();
        var balances = ledger.stock.entrySet().stream()
                .filter(entry -> access.locations().contains(entry.getKey().location()))
                .map(entry -> new Balance(entry.getKey().lot(), entry.getKey().location(), entry.getValue()))
                .sorted(Comparator.comparing((Balance row) -> row.lot().item())
                        .thenComparing(row -> row.lot().lot()).thenComparing(Balance::location, LOCATION_ORDER))
                .toList();
        var movements = ledger.movements.values().stream()
                .filter(row -> within(access, row.source(), row.destination())).toList();
        var readable = movements.stream().map(Movement::id).collect(Collectors.toSet());
        var documents = ledger.documents.values().stream()
                .filter(doc -> readable.containsAll(doc.movementIds())).toList();
        return ok(new View(actor, ledger.version, access.canMove(), locations, balances, movements, documents));
    }

    @Override
    public synchronized Reply<Result> execute(Actor actor, Command original) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.site());
        TerminalAccess access = access(ledger, actor);
        if (access == null || !access.canMove()) return error(403, "TERMINAL_OUT_OF_SCOPE");
        if (!valid(original)) return error(422, "INVALID_COMMAND");
        Command command = normalize(original);

        Receipt prior = ledger.receipts.get(command.requestId());
        if (prior != null) {
            if (!prior.actor().equals(actor)) return error(403, "COMMAND_ACTOR_MISMATCH");
            return prior.command().equals(command) ? ok(prior.result()) : error(409, "REQUEST_ID_REUSED");
        }
        if (command.expectedVersion() != ledger.version) return error(409, "STALE_VERSION");

        var changed = apply(ledger, access, actor, command, nextNumber);
        if (changed.status() != 200) return error(changed.status(), changed.error());
        var movement = changed.value();
        if (command.action() == Action.MOVE) {
            nextNumber++;
            ledger.documents.put(movement.id(), new DocumentHeader(movement.id(), movement.id(), LocalDate.now(clock),
                    movement.destination().warehouse(), actor, List.of(movement.id())));
        } else {
            var parent = ledger.documents.values().stream().filter(doc -> doc.movementIds().contains(movement.id())).findFirst();
            parent.ifPresent(doc -> removeLines(ledger, doc, List.of(movement.id())));
        }
        Result result = new Result(++ledger.version, movement);
        ledger.receipts.put(command.requestId(), new Receipt(actor, command, result));
        return ok(result);
    }

    private Reply<Movement> apply(Ledger ledger, TerminalAccess access, Actor actor, Command command, long movementNumber) {
        Movement movement = null;
        Route route;
        if (command.action() == Action.MOVE) {
            route = new Route(command.lot(), command.source(), command.destination(), command.quantity());
        } else {
            movement = ledger.movements.get(command.movementId());
            if (movement == null) return error(404, "MOVEMENT_NOT_FOUND");
            if (!movement.movedBy().terminal().equals(actor.terminal())) return error(403, "CANCEL_TERMINAL_MISMATCH");
            if (movement.status() == Status.CANCELLED) return error(409, "ALREADY_CANCELLED");
            route = new Route(movement.lot(), movement.destination(), movement.source(), movement.quantity());
        }

        if (!within(access, route.source(), route.destination())) return error(403, "LOCATION_OUT_OF_SCOPE");
        if (route.source().warehouse().equals(route.destination().warehouse())) return error(422, "SAME_WAREHOUSE");
        StockKey from = new StockKey(route.lot(), route.source());
        StockKey to = new StockKey(route.lot(), route.destination());
        BigDecimal remainder = ledger.balance(from).subtract(route.quantity());
        if (remainder.signum() < 0) return error(409, "INSUFFICIENT_STOCK");
        BigDecimal received = ledger.balance(to).add(route.quantity());
        if (received.compareTo(MAX) > 0) return error(409, "STOCK_OVERFLOW");

        Instant now = clock.instant();
        Movement after;
        if (movement == null) {
            after = new Movement("INV-DEMO-" + movementNumber, route.lot(), route.source(), route.destination(),
                    route.quantity(), Status.MOVED, actor, now, null, null);
        } else {
            after = new Movement(movement.id(), movement.lot(), movement.source(), movement.destination(),
                    movement.quantity(), Status.CANCELLED, movement.movedBy(), movement.movedAt(), actor, now);
        }
        ledger.stock.put(from, remainder);
        ledger.stock.put(to, received);
        ledger.movements.put(after.id(), after);
        return ok(after);
    }

    @Override
    public synchronized Reply<DocumentResult> document(Actor actor, DocumentCommand command) {
        if (!valid(actor)) return error(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.site());
        TerminalAccess access = access(ledger, actor);
        if (access == null || !access.canMove()) return error(403, "TERMINAL_OUT_OF_SCOPE");
        if (command == null || command.action() == null || blank(command.requestId()) || command.requestId().length() > 128
                || command.expectedVersion() == null || command.expectedVersion() < 0) return error(422, "INVALID_COMMAND");
        var prior = ledger.documentReceipts.get(command.requestId());
        if (prior != null) {
            if (!prior.actor().equals(actor)) return error(403, "COMMAND_ACTOR_MISMATCH");
            return prior.command().equals(command) ? ok(prior.result()) : error(409, "REQUEST_ID_REUSED");
        }
        if (command.expectedVersion() != ledger.version) return error(409, "STALE_VERSION");
        var draft = new Ledger(ledger);
        String number = command.documentNo();
        if (command.action() == DocumentAction.SAVE) {
            if (number != null || !actor.site().site().equals(command.destinationSite()) || blank(command.warehouse())
                    || command.lines() == null || command.lines().isEmpty() || command.selectedIds() != null)
                return error(422, "INVALID_COMMAND");
            List<String> ids = new ArrayList<>();
            long nextMovement = nextNumber;
            for (var line : command.lines()) {
                if (line == null || !valid(line.lot()) || !valid(line.source()) || !valid(line.rowDestination())
                        || !validQuantity(line.quantity()) || line.quantity().signum() < 0
                        || line.quantity().stripTrailingZeros().scale() > 0) return error(422, "INVALID_COMMAND");
                if (!access.locations().contains(line.rowDestination())) return error(403, "LOCATION_OUT_OF_SCOPE");
                if (!draft.stock.containsKey(new StockKey(line.lot(), line.source()))) return error(422, "INVALID_COMMAND");
                // frmLogistics5 binds the header warehouse and the location from the individual row.
                var destination = new Location(command.warehouse(), line.rowDestination().position());
                var move = new Command(Action.MOVE, command.requestId(), ledger.version, null, line.lot(),
                        line.source(), destination, line.quantity().setScale(3));
                var reply = apply(draft, access, actor, move, nextMovement++);
                if (reply.status() != 200) return error(reply.status(), reply.error());
                ids.add(reply.value().id());
            }
            var date = LocalDate.now(clock);
            String day = date.format(DateTimeFormatter.BASIC_ISO_DATE);
            String counterKey = actor.site().factory() + "/" + day;
            int serial = dayNumbers.getOrDefault(counterKey + "/output", 0) + 1;
            int requestSerial = dayNumbers.getOrDefault(counterKey + "/request", 0) + 1;
            if (serial > 9999 || requestSerial > 9999) return error(409, "DOCUMENT_NUMBER_EXHAUSTED");
            number = day + String.format(java.util.Locale.ROOT, "%04d", serial);
            String requestNumber = day + String.format(java.util.Locale.ROOT, "%04d", requestSerial);
            nextNumber = nextMovement;
            dayNumbers.put(counterKey + "/output", serial);
            dayNumbers.put(counterKey + "/request", requestSerial);
            ledger.documents.put(number, new DocumentHeader(number, requestNumber, date, command.warehouse(), actor, List.copyOf(ids)));
        } else {
            if (blank(number) || command.lines() != null || command.selectedIds() == null || command.selectedIds().isEmpty()
                    || new HashSet<>(command.selectedIds()).size() != command.selectedIds().size()) return error(422, "INVALID_COMMAND");
            var doc = ledger.documents.get(number);
            if (doc == null || !doc.movementIds().containsAll(command.selectedIds())) return error(404, "MOVEMENT_NOT_FOUND");
            for (String id : command.selectedIds()) {
                var cancel = new Command(Action.CANCEL, command.requestId(), ledger.version, id, null, null, null, null);
                var reply = apply(draft, access, actor, cancel, 0);
                if (reply.status() != 200) return error(reply.status(), reply.error());
            }
            removeLines(ledger, doc, command.selectedIds());
            if (!ledger.documents.containsKey(number)) number = null;
        }
        ledger.stock.putAll(draft.stock);
        ledger.movements.putAll(draft.movements);
        var result = new DocumentResult(++ledger.version, number);
        ledger.documentReceipts.put(command.requestId(), new DocumentReceipt(actor, command, result));
        return ok(result);
    }

    private static void removeLines(Ledger ledger, DocumentHeader doc, List<String> selected) {
        var remaining = doc.movementIds().stream().filter(id -> !selected.contains(id)).toList();
        if (remaining.isEmpty()) ledger.documents.remove(doc.number());
        else ledger.documents.put(doc.number(), new DocumentHeader(doc.number(), doc.requestNo(), doc.date(),
                doc.warehouse(), doc.actor(), remaining));
    }

    private static TerminalAccess access(Ledger ledger, Actor actor) {
        return ledger == null ? null : ledger.terminals.get(actor.terminal());
    }

    private static boolean within(TerminalAccess access, Location source, Location destination) {
        return access.locations().contains(source) && access.locations().contains(destination);
    }

    private static boolean valid(Actor actor) {
        return actor != null && actor.site() != null && !blank(actor.site().factory()) && !blank(actor.site().site())
                && !blank(actor.terminal()) && !blank(actor.worker());
    }

    private static boolean valid(Command command) {
        if (command == null || command.action() == null || blank(command.requestId())
                || command.requestId().length() > 128 || command.expectedVersion() == null
                || command.expectedVersion() < 0) return false;
        if (command.action() == Action.MOVE) {
            return command.movementId() == null && valid(command.lot()) && valid(command.source())
                    && valid(command.destination()) && validQuantity(command.quantity())
                    && command.quantity().signum() > 0;
        }
        return !blank(command.movementId()) && command.lot() == null && command.source() == null
                && command.destination() == null && command.quantity() == null;
    }

    private static Command normalize(Command command) {
        if (command.action() == Action.CANCEL) return command;
        return new Command(command.action(), command.requestId(), command.expectedVersion(), null,
                command.lot(), command.source(), command.destination(), command.quantity().setScale(3));
    }

    private static boolean valid(Lot lot) {
        return lot != null && !blank(lot.item()) && !blank(lot.lot());
    }

    private static boolean valid(Location location) {
        return location != null && !blank(location.warehouse()) && !blank(location.position());
    }

    private static boolean validQuantity(BigDecimal quantity) {
        return quantity != null && quantity.abs().compareTo(MAX) <= 0
                && quantity.stripTrailingZeros().scale() <= 3;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static <T> Reply<T> ok(T value) {
        return new Reply<>(200, null, value);
    }

    private static <T> Reply<T> error(int status, String code) {
        return new Reply<>(status, code, null);
    }
}
