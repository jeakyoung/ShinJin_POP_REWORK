package synthetic.inventory;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
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
    private record Route(Lot lot, Location source, Location destination, BigDecimal quantity) {}

    private static final class Ledger {
        final Map<String, TerminalAccess> terminals;
        final Map<StockKey, BigDecimal> stock = new HashMap<>();
        final Map<String, Movement> movements = new LinkedHashMap<>();
        final Map<String, Receipt> receipts = new HashMap<>();
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
    }

    private final Clock clock;
    private final Map<Site, Ledger> ledgers = new HashMap<>();
    private long nextNumber = 1;

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
        return ok(new View(actor, ledger.version, access.canMove(), locations, balances, movements));
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
            after = new Movement("INV-DEMO-" + nextNumber++, route.lot(), route.source(), route.destination(),
                    route.quantity(), Status.MOVED, actor, now, null, null);
        } else {
            after = new Movement(movement.id(), movement.lot(), movement.source(), movement.destination(),
                    movement.quantity(), Status.CANCELLED, movement.movedBy(), movement.movedAt(), actor, now);
        }
        ledger.stock.put(from, remainder);
        ledger.stock.put(to, received);
        ledger.movements.put(after.id(), after);
        Result result = new Result(++ledger.version, after);
        ledger.receipts.put(command.requestId(), new Receipt(actor, command, result));
        return ok(result);
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
