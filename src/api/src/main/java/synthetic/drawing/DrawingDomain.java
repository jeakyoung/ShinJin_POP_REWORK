package synthetic.drawing;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

public interface DrawingDomain {
    enum State { CUT_READY, PACK1_ACTIVE, DRAW_READY, DRAW_ACTIVE, PACK2_READY, PACK2_ACTIVE, SHIP_READY }
    enum Decision { PROBE, ACCEPT, DECLINE }
    enum Action { PACK1_START, PACK1_FINISH, DRAW_START, DRAW_FINISH, PACK2_START, PACK2_FINISH }
    enum OrderType { DRAWING, DRAWING_DEFERRED, OTHER }
    enum Bin { CUT, DRAWING, REMNANT, PRODUCT, SHIPPING, MANUAL }

    record PlanKey(String factory, String site, LocalDate date, int sequence) {}
    record Session(String factory, String site, String terminal, String operator) {}
    record StockKey(String lot, Bin bin, String item) {}
    record Input(StockKey stock, BigDecimal quantity) {}
    record Seed(PlanKey key, OrderType type, String item, BigDecimal orderQuantity,
                StockKey cutStock, StockKey remnantStock, Map<StockKey, BigDecimal> stock) {
        public Seed { stock = Map.copyOf(stock); }
    }
    record Command(Action action, long expectedVersion, String requestId, StockKey stock,
                   BigDecimal quantity, String scanToken, List<Input> inputs) {
        public Command { inputs = inputs == null ? List.of() : List.copyOf(inputs); }
    }
    record Snapshot(State state, String plateFlag, long version, String ownerTerminal,
                    boolean bypassedPack1, Shipment shipment, String activeGroupId) {}
    record Shipment(String id, StockKey stock, BigDecimal quantity, boolean deferred,
                    Instant startedAt, Instant finishedAt) {}
    record Scan(boolean accepted, String token, List<Input> materials) {
        public Scan { materials = List.copyOf(materials); }
    }
    record Reply<T>(int status, String error, T value) {}

    Reply<Snapshot> get(Session session, PlanKey key);
    List<PlanKey> active(Session session);
    Reply<Scan> scan(Session session, PlanKey key, Decision decision);
    Reply<Snapshot> execute(Session session, PlanKey key, Command command);
}
