package synthetic.drawing;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

public interface DrawingDomain {
    enum State { CUT_READY, PACK1_ACTIVE, DRAW_READY, DRAW_ACTIVE, DRAW_PAUSED, PACK2_READY, PACK2_ACTIVE, STANDARD_PACK_ACTIVE, STANDARD_PACK_PAUSED, SHIP_READY }
    enum Decision { PROBE, ACCEPT, DECLINE }
    enum Action { PACK1_START, PACK1_FINISH, DRAW_START, DRAW_PAUSE, DRAW_RESUME, DRAW_FINISH, PACK2_START, PACK2_FINISH, STANDARD_PACK_START, STANDARD_PACK_PAUSE, STANDARD_PACK_RESUME, STANDARD_PACK_FINISH, STANDARD_PACK_CANCEL }
    enum OrderType { DRAWING, DRAWING_DEFERRED, STANDARD_PACK, OTHER }
    enum Bin { CUT, DRAWING, REMNANT, PRODUCT, SHIPPING, MANUAL }

    record PlanKey(String factory, String site, LocalDate date, int sequence) {}
    record Session(String factory, String site, String terminal, String operator) {}
    record StockKey(String lot, Bin bin, String item, String location) {
        public StockKey(String lot, Bin bin, String item) { this(lot, bin, item, null); }
    }
    record Input(StockKey stock, BigDecimal quantity) {}
    record Seed(PlanKey key, OrderType type, String item, BigDecimal orderQuantity,
                StockKey cutStock, StockKey remnantStock, Map<StockKey, BigDecimal> stock) {
        public Seed { stock = Map.copyOf(stock); }
    }
    record MaterialReturn(String warehouse, String location, String material, BigDecimal thickness,
                          BigDecimal width, BigDecimal length, BigDecimal quantity) {}
    record GoodPlace(String warehouse, String warehouseName, String location, String locationName,
                     String workStatus, String etc) {}
    record ProductWeight(PlanKey plan,BigDecimal quantity) {}
    record WeightBasis(PlanKey focus,List<Input> inputs,List<ProductWeight> products,List<MaterialReturn> returns) {
        public WeightBasis { inputs=List.copyOf(inputs);products=List.copyOf(products);returns=List.copyOf(returns); }
    }
    record Command(Action action, long expectedVersion, String requestId, StockKey stock,
                   BigDecimal quantity, String scanToken, List<Input> inputs, List<MaterialReturn> returns, GoodPlace goodPlace,WeightBasis basis) {
        public Command(Action action,long version,String id,StockKey stock,BigDecimal quantity,String token,List<Input> inputs,
                       List<MaterialReturn> returns,GoodPlace place) {
            this(action,version,id,stock,quantity,token,inputs,returns,place,null);
        }
        public Command(Action action, long expectedVersion, String requestId, StockKey stock,
                       BigDecimal quantity, String scanToken, List<Input> inputs, List<MaterialReturn> returns) {
            this(action, expectedVersion, requestId, stock, quantity, scanToken, inputs, returns, null);
        }
        public Command(Action action, long expectedVersion, String requestId, StockKey stock,
                       BigDecimal quantity, String scanToken, List<Input> inputs) {
            this(action, expectedVersion, requestId, stock, quantity, scanToken, inputs, List.of());
        }
        public Command {
            inputs = inputs == null ? List.of() : List.copyOf(inputs);
            returns = returns == null ? List.of() : List.copyOf(returns);
        }
    }
    record Snapshot(State state, String plateFlag, long version, String ownerTerminal,
                    boolean bypassedPack1, Shipment shipment, String activeGroupId, String productionGroupNo, GoodPlace goodPlace) {}
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
