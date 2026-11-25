package synthetic.inventory;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface InventoryDomain {
    enum Action { MOVE, CANCEL }
    enum Status { MOVED, CANCELLED }

    record Site(String factory, String site) {}
    record Actor(Site site, String terminal, String worker) {}
    record Location(String warehouse, String position) {}
    record Lot(String item, String lot) {}
    record StockKey(Lot lot, Location location) {}
    record TerminalAccess(Set<Location> locations, boolean canMove) {
        public TerminalAccess { locations = Set.copyOf(locations); }
    }
    record Seed(Map<String, TerminalAccess> terminals, Map<StockKey, BigDecimal> stock) {
        public Seed { terminals = Map.copyOf(terminals); stock = Map.copyOf(stock); }
    }
    record Balance(Lot lot, Location location, BigDecimal quantity) {}
    record Movement(String id, Lot lot, Location source, Location destination, BigDecimal quantity,
                    Status status, Actor movedBy, Instant movedAt, Actor cancelledBy, Instant cancelledAt) {}
    record Command(Action action, String requestId, Long expectedVersion, String movementId,
                   Lot lot, Location source, Location destination, BigDecimal quantity) {}
    record Result(long version, Movement movement) {}
    record View(Actor actor, long version, boolean canMove, List<Location> locations,
                List<Balance> balances, List<Movement> movements) {
        public View {
            locations = List.copyOf(locations);
            balances = List.copyOf(balances);
            movements = List.copyOf(movements);
        }
    }
    record Reply<T>(int status, String error, T value) {}

    Reply<View> view(Actor actor);
    Reply<Result> execute(Actor actor, Command command);
}
