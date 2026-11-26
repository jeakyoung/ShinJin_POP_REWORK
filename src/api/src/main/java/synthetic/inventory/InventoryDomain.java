package synthetic.inventory;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
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
    enum DocumentAction { SAVE, DELETE_LINES }
    record MoveLine(Lot lot, Location source, Location rowDestination, BigDecimal quantity) {}
    record DocumentCommand(DocumentAction action, String requestId, Long expectedVersion, String documentNo,
                           String destinationSite, String warehouse, List<MoveLine> lines, List<String> selectedIds) {}
    record DocumentHeader(String number, String requestNo, LocalDate date, String warehouse,
                          Actor actor, List<String> movementIds) {}
    record DocumentResult(long version, String documentNo) {}
    record View(Actor actor, long version, boolean canMove, List<Location> locations,
                List<Balance> balances, List<Movement> movements, List<DocumentHeader> documents) {
        public View {
            locations = List.copyOf(locations);
            balances = List.copyOf(balances);
            movements = List.copyOf(movements);
            documents = List.copyOf(documents);
        }
    }
    record Reply<T>(int status, String error, T value) {}

    Reply<View> view(Actor actor);
    Reply<Result> execute(Actor actor, Command command);
    Reply<DocumentResult> document(Actor actor, DocumentCommand command);
}
