package synthetic.drawing;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static synthetic.drawing.DrawingDomain.State.*;

public final class InMemoryDrawingDomain implements DrawingDomain {
    private record RequestKey(String terminal, String id) {}
    private record Receipt(Command command, Snapshot snapshot) {}
    private record Permit(boolean bypass, String token) {}
    public record StageRecord(Action action, String operator, String terminal, long version, Instant recordedAt,
                              String drawingDailyId, String shipmentId) {}
    public record Audit(Map<StockKey, BigDecimal> inventory, List<StageRecord> records) {}

    private static final class Plan {
        final Seed seed;
        final Map<StockKey, BigDecimal> stock;
        final Map<RequestKey, Receipt> receipts = new HashMap<>();
        final Map<String, Permit> permits = new HashMap<>();
        final List<StageRecord> records = new ArrayList<>();
        State state = CUT_READY;
        long version;
        String owner;
        boolean bypass;
        Instant pack2Started;
        Shipment shipment;

        Plan(Seed seed) {
            this.seed = seed;
            stock = new HashMap<>(seed.stock());
        }

        Plan(Plan source) {
            seed = source.seed;
            stock = new HashMap<>(source.stock);
            receipts.putAll(source.receipts);
            permits.putAll(source.permits);
            records.addAll(source.records);
            state = source.state;
            version = source.version;
            owner = source.owner;
            bypass = source.bypass;
            pack2Started = source.pack2Started;
            shipment = source.shipment;
        }

        StockKey output(Bin bin) {
            String lot = (bin == Bin.DRAWING ? "P1-" : "D-") + seed.item().replaceFirst("^ITEM-", "");
            return new StockKey(lot, bin, seed.item());
        }

        BigDecimal balance(StockKey stockKey) {
            return stock.getOrDefault(stockKey, BigDecimal.ZERO);
        }

        void add(StockKey key, BigDecimal quantity) {
            stock.put(key, balance(key).add(quantity));
        }

        Snapshot snapshot() {
            String flag = switch (state) {
                case DRAW_READY -> "1";
                case DRAW_ACTIVE -> bypass ? null : "1";
                case PACK2_READY, PACK2_ACTIVE -> "2";
                default -> null;
            };
            return new Snapshot(state, flag, version, owner, bypass, shipment);
        }
    }

    private final Map<PlanKey, Plan> plans = new LinkedHashMap<>();
    private final Clock clock;

    public InMemoryDrawingDomain(Clock clock, List<Seed> seeds) {
        this.clock = Objects.requireNonNull(clock);
        for (Seed seed : seeds) {
            if (!positive(seed.orderQuantity()) || seed.cutStock().bin() != Bin.CUT
                    || (seed.remnantStock() != null && seed.remnantStock().bin() != Bin.REMNANT)
                    || seed.stock().entrySet().stream().anyMatch(entry -> entry.getValue().signum() < 0
                        || !inputBin(entry.getKey().bin()) || entry.getKey().bin() == Bin.DRAWING)) {
                throw new IllegalArgumentException("Invalid fixture seed");
            }
            if (plans.putIfAbsent(seed.key(), new Plan(seed)) != null) {
                throw new IllegalArgumentException("Duplicate plan key");
            }
        }
    }

    @Override
    public synchronized Reply<Snapshot> get(Session session, PlanKey key) {
        if (!validSession(session)) return error(401, "INVALID_SESSION");
        if (!inScope(session, key)) return error(403, "PLAN_OUT_OF_SCOPE");
        Plan plan = plans.get(key);
        return plan == null ? error(404, "PLAN_NOT_FOUND") : ok(plan.snapshot());
    }

    @Override
    public synchronized List<PlanKey> active(Session session) {
        if (!validSession(session)) return List.of();
        return plans.entrySet().stream()
                .filter(entry -> inScope(session, entry.getKey()) && entry.getValue().state == DRAW_ACTIVE)
                .map(Map.Entry::getKey).toList();
    }

    @Override
    public synchronized Reply<Scan> scan(Session session, PlanKey key, Decision decision) {
        if (!validSession(session)) return error(401, "INVALID_SESSION");
        if (!inScope(session, key)) return error(403, "PLAN_OUT_OF_SCOPE");
        Plan plan = plans.get(key);
        if (plan == null) return error(404, "PLAN_NOT_FOUND");
        if (plan.seed.type() == OrderType.OTHER) return error(422, "ORDER_NOT_DRAWING");
        if (plan.state != CUT_READY && plan.state != DRAW_READY) return error(409, "INVALID_STATE");
        if (decision == null) return error(422, "INVALID_DECISION");

        boolean bypass = plan.state == CUT_READY;
        if (bypass && decision == Decision.PROBE) return error(409, "PACK1_CONFIRM_REQUIRED");
        if (decision == Decision.DECLINE) {
            plan.permits.remove(session.terminal());
            return ok(new Scan(false, null, List.of()));
        }
        String token = UUID.randomUUID().toString();
        plan.permits.put(session.terminal(), new Permit(bypass, token));
        StockKey stock = bypass ? plan.seed.remnantStock() : plan.output(Bin.DRAWING);
        BigDecimal available = plan.balance(stock);
        List<Input> materials = positive(available)
                ? List.of(new Input(stock, bypass ? available.min(BigDecimal.ONE) : available))
                : List.of();
        return ok(new Scan(true, token, materials));
    }

    @Override
    public synchronized Reply<Snapshot> execute(Session session, PlanKey key, Command command) {
        if (!validSession(session)) return error(401, "INVALID_SESSION");
        if (!inScope(session, key)) return error(403, "PLAN_OUT_OF_SCOPE");
        Plan plan = plans.get(key);
        if (plan == null) return error(404, "PLAN_NOT_FOUND");
        if (command == null || command.requestId() == null || command.requestId().isBlank()) {
            return error(422, "REQUEST_ID_REQUIRED");
        }
        command = normalized(command);
        RequestKey request = new RequestKey(session.terminal(), command.requestId());
        Receipt receipt = plan.receipts.get(request);
        if (receipt != null) {
            return receipt.command().equals(command)
                    ? ok(receipt.snapshot()) : error(409, "REQUEST_ID_REUSED");
        }
        if (plan.owner != null && !plan.owner.equals(session.terminal())) {
            return error(409, "TERMINAL_MISMATCH");
        }
        if (command.expectedVersion() != plan.version) return error(409, "STALE_VERSION");
        if (plan.seed.type() == OrderType.OTHER) return error(422, "ORDER_NOT_DRAWING");
        if (command.action() == null) return error(422, "ACTION_REQUIRED");

        plan = new Plan(plan);
        Reply<Snapshot> rejection = switch (command.action()) {
            case PACK1_START -> start(plan, CUT_READY, PACK1_ACTIVE, session);
            case PACK1_FINISH -> finishPack1(plan, command);
            case DRAW_START -> startDrawing(plan, session, command);
            case DRAW_FINISH -> finishDrawing(plan, command.quantity());
            case PACK2_START -> startPack2(plan, session);
            case PACK2_FINISH -> finishPack2(plan, command.quantity());
        };
        if (rejection != null) return rejection;
        plan.version++;
        plan.permits.clear();
        if (command.action() != Action.PACK2_START) {
            plan.records.add(new StageRecord(command.action(), session.operator(), session.terminal(), plan.version,
                    clock.instant(), command.action() == Action.DRAW_FINISH ? "DAILY-" + plan.seed.key() : null,
                    plan.shipment == null ? null : plan.shipment.id()));
        }
        Snapshot snapshot = plan.snapshot();
        plan.receipts.put(request, new Receipt(command, snapshot));
        plans.put(key, plan);
        return ok(snapshot);
    }

    private Reply<Snapshot> start(Plan plan, State from, State to, Session session) {
        if (plan.state != from) return error(409, "INVALID_STATE");
        plan.state = to;
        plan.owner = session.terminal();
        return null;
    }

    private Reply<Snapshot> finishPack1(Plan plan, Command command) {
        if (plan.state != PACK1_ACTIVE) return error(409, "INVALID_STATE");
        if (!plan.seed.cutStock().equals(command.stock())) return error(422, "INVALID_PACK_LOT");
        BigDecimal qty = command.quantity();
        if (!positive(qty)) return error(422, "INVALID_QUANTITY");
        if (qty.compareTo(plan.balance(command.stock())) > 0
                || qty.compareTo(plan.seed.orderQuantity()) > 0) {
            return error(422, "PACK_QTY_EXCEEDED");
        }
        plan.add(command.stock(), qty.negate());
        plan.add(plan.output(Bin.DRAWING), qty);
        finishStage(plan, DRAW_READY);
        return null;
    }

    private Reply<Snapshot> startDrawing(Plan plan, Session session, Command command) {
        if (plan.state != CUT_READY && plan.state != DRAW_READY) return error(409, "INVALID_STATE");
        if (command.scanToken() == null || command.scanToken().isBlank()) {
            return error(422, "SCAN_TOKEN_REQUIRED");
        }
        Permit permit = plan.permits.get(session.terminal());
        if (permit == null || !permit.token().equals(command.scanToken())) {
            return error(409, "SCAN_TOKEN_INVALID");
        }
        if (command.inputs().isEmpty()) return error(422, "INPUT_REQUIRED");
        Map<StockKey, BigDecimal> totals = new HashMap<>();
        for (Input input : command.inputs()) {
            if (input.stock() == null || !inputBin(input.stock().bin()) || !positive(input.quantity())) {
                return error(422, "INVALID_INPUT");
            }
            totals.merge(input.stock(), input.quantity(), BigDecimal::add);
        }
        for (var entry : totals.entrySet()) {
            if (entry.getValue().compareTo(plan.balance(entry.getKey())) > 0) {
                return error(422, "INSUFFICIENT_INPUT");
            }
        }
        totals.forEach((stock, quantity) -> plan.add(stock, quantity.negate()));
        plan.bypass = permit.bypass();
        plan.state = DRAW_ACTIVE;
        plan.owner = session.terminal();
        return null;
    }

    private Reply<Snapshot> finishDrawing(Plan plan, BigDecimal qty) {
        if (plan.state != DRAW_ACTIVE) return error(409, "INVALID_STATE");
        if (!positive(qty) || qty.compareTo(plan.seed.orderQuantity()) > 0) {
            return error(422, "INVALID_QUANTITY");
        }
        plan.add(plan.output(Bin.PRODUCT), qty);
        finishStage(plan, PACK2_READY);
        return null;
    }

    private Reply<Snapshot> startPack2(Plan plan, Session session) {
        if (plan.state != PACK2_READY) return error(409, "INVALID_STATE");
        Instant now = clock.instant();
        start(plan, PACK2_READY, PACK2_ACTIVE, session);
        plan.pack2Started = now;
        return null;
    }

    private Reply<Snapshot> finishPack2(Plan plan, BigDecimal qty) {
        if (plan.state == SHIP_READY) return error(409, "ALREADY_PACKED");
        if (plan.state != PACK2_READY && plan.state != PACK2_ACTIVE) return error(409, "INVALID_STATE");
        StockKey product = plan.output(Bin.PRODUCT);
        BigDecimal available = plan.balance(product);
        BigDecimal quantity = qty == null ? available : qty;
        if (!positive(quantity)) return error(422, "INVALID_QUANTITY");
        if (quantity.compareTo(available) > 0 || quantity.compareTo(plan.seed.orderQuantity()) > 0) {
            return error(422, "PACK_QTY_EXCEEDED");
        }

        if (quantity.compareTo(available) < 0) return error(422, "PACK_QTY_MUST_MATCH_REMAINING");

        Instant finished = clock.instant();
        Instant started = plan.pack2Started == null ? finished : plan.pack2Started;
        StockKey shipping = plan.output(Bin.SHIPPING);
        PlanKey key = plan.seed.key();
        String id = "SHIP-" + key.factory() + "/" + key.site() + "/" + key.date() + "/" + key.sequence();
        plan.shipment = new Shipment(id, shipping, quantity, plan.seed.type() == OrderType.DRAWING_DEFERRED,
                started, finished);
        plan.add(product, quantity.negate());
        plan.add(shipping, quantity);
        finishStage(plan, SHIP_READY);
        return null;
    }

    public synchronized Audit audit(Session session, PlanKey key) {
        if (!validSession(session) || !inScope(session, key) || !plans.containsKey(key)) return new Audit(Map.of(), List.of());
        var plan = plans.get(key);
        return new Audit(Map.copyOf(plan.stock), List.copyOf(plan.records));
    }

    public synchronized Map<StockKey, BigDecimal> inventory(Session session, PlanKey key) {
        if (!validSession(session) || !inScope(session, key) || !plans.containsKey(key)) return Map.of();
        return Map.copyOf(plans.get(key).stock);
    }

    private static void finishStage(Plan plan, State state) {
        plan.state = state;
        plan.owner = null;
    }

    private static boolean validSession(Session session) {
        return session != null && present(session.factory()) && present(session.site())
                && present(session.terminal()) && present(session.operator());
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }

    private static boolean inScope(Session session, PlanKey key) {
        return key != null && session.factory().equals(key.factory()) && session.site().equals(key.site());
    }

    private static boolean inputBin(Bin bin) {
        return bin == Bin.CUT || bin == Bin.DRAWING || bin == Bin.REMNANT || bin == Bin.MANUAL;
    }

    private static boolean positive(BigDecimal quantity) {
        return quantity != null && quantity.signum() > 0 && quantity.scale() >= -18 && quantity.scale() <= 64
                && quantity.precision() <= 64 && quantity.stripTrailingZeros().scale() <= 3
                && quantity.precision() - quantity.scale() <= 15;
    }

    private static BigDecimal normalized(BigDecimal quantity) {
        return positive(quantity) ? quantity.setScale(3) : quantity;
    }

    private static Command normalized(Command command) {
        var inputs = command.inputs().stream()
                .map(input -> new Input(input.stock(), normalized(input.quantity()))).toList();
        return new Command(command.action(), command.expectedVersion(), command.requestId(), command.stock(),
                normalized(command.quantity()), command.scanToken(), inputs);
    }

    private static <T> Reply<T> ok(T value) {
        return new Reply<>(200, null, value);
    }

    private static <T> Reply<T> error(int status, String code) {
        return new Reply<>(status, code, null);
    }
}
