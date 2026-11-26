package synthetic.drawing;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
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
                              String drawingDailyId, String shipmentId, String movementId, Integer movementLine) {}
    public record SharedLot(String factory, String site, StockKey stock, BigDecimal quantity) {}
    public record GroupSeed(String id, List<PlanKey> members) {
        public GroupSeed { members = List.copyOf(members); }
    }
    public record GroupResult(String drawingDailyId, String movementId, int movementLine) {}
    public record GroupMember(PlanKey key, Snapshot snapshot, GroupResult result, List<Input> drawingInputs, Input autoRemnant) {}
    public record GroupCandidate(StockKey stock, BigDecimal available, List<PlanKey> eligiblePlans) {}
    public record GroupView(String id, List<GroupMember> members, List<GroupCandidate> candidates) {}
    public record GroupLine(PlanKey key, long expectedVersion, List<Input> inputs, BigDecimal goodQty, boolean confirmSkip) {
        public GroupLine(PlanKey key, long expectedVersion, List<Input> inputs, BigDecimal goodQty) {
            this(key, expectedVersion, inputs, goodQty, false);
        }
        public GroupLine { inputs = inputs == null ? List.of() : List.copyOf(inputs); }
    }
    public enum GroupAction { DRAW_START, DRAW_FINISH }
    public record GroupCommand(GroupAction action, String requestId, List<GroupLine> members) {
        public GroupCommand { members = members == null ? List.of() : List.copyOf(members); }
    }
    private record SharedKey(String factory, String site, StockKey stock) {
        static SharedKey of(PlanKey key, StockKey stock) {
            return new SharedKey(key.factory(), key.site(), stock);
        }
    }
    private record GroupRequest(String groupId, RequestKey request) {}
    private record GroupReceipt(GroupCommand command, GroupView result) {}
    public record Audit(Map<StockKey, BigDecimal> inventory, List<StageRecord> records, List<Input> drawingInputs) {}

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
        String activeGroup;
        GroupResult groupResult;
        List<Input> drawingInputs = List.of();

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
            activeGroup = source.activeGroup;
            groupResult = source.groupResult;
            drawingInputs = source.drawingInputs;
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
            return new Snapshot(state, flag, version, owner, bypass, shipment, activeGroup);
        }
    }

    private final Map<PlanKey, Plan> plans = new LinkedHashMap<>();
    private final Map<String, GroupSeed> groups = new LinkedHashMap<>();
    private final Map<GroupRequest, GroupReceipt> groupReceipts = new HashMap<>();
    private Map<SharedKey, BigDecimal> sharedStock;
    private final Clock clock;

    public InMemoryDrawingDomain(Clock clock, List<Seed> seeds) {
        this(clock, seeds, List.of(), List.of());
    }

    public InMemoryDrawingDomain(Clock clock, List<Seed> seeds, List<GroupSeed> groupSeeds, List<SharedLot> sharedLots) {
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
        var grouped = new HashSet<PlanKey>();
        for (var group : groupSeeds) {
            if (!present(group.id()) || group.members().size() < 2 || groups.putIfAbsent(group.id(), group) != null) {
                throw new IllegalArgumentException("Invalid production group");
            }
            var first = group.members().get(0);
            for (var member : group.members()) {
                if (!sameSite(first, member) || !plans.containsKey(member)
                        || !drawingOrder(plans.get(member)) || !grouped.add(member)) {
                    throw new IllegalArgumentException("Invalid production group member");
                }
            }
        }
        var shared = new HashMap<SharedKey, BigDecimal>();
        for (var lot : sharedLots) {
            var key = new SharedKey(lot.factory(), lot.site(), lot.stock());
            if (!positive(lot.quantity()) || !inputBin(lot.stock().bin()) || lot.stock().bin() == Bin.CUT
                    || !present(lot.stock().lot()) || !present(lot.stock().item())
                    || shared.putIfAbsent(key, lot.quantity()) != null
                    || plans.values().stream().anyMatch(plan -> SharedKey.of(plan.seed.key(), lot.stock()).equals(key)
                            && (plan.stock.containsKey(lot.stock()) || plan.output(Bin.DRAWING).equals(lot.stock())))) {
                throw new IllegalArgumentException("Invalid or duplicated shared LOT");
            }
        }
        sharedStock = Map.copyOf(shared);
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
        if (!drawingOrder(plan)) return error(422, "ORDER_NOT_DRAWING");
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
        BigDecimal available = sharedStock.getOrDefault(SharedKey.of(key, stock), plan.balance(stock));
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
        if (command.action() == null) return error(422, "ACTION_REQUIRED");
        boolean standard = command.action() == Action.STANDARD_PACK_START || command.action() == Action.STANDARD_PACK_FINISH;
        if (standard && plan.seed.type() != OrderType.STANDARD_PACK) return error(422, "ORDER_NOT_STANDARD_PACK");
        if (!standard && !drawingOrder(plan)) return error(422, "ORDER_NOT_DRAWING");

        if (plan.activeGroup != null && command.action() == Action.DRAW_FINISH) {
            return error(409, "GROUP_FINISH_REQUIRED");
        }
        plan = new Plan(plan);
        var stock = command.action() == Action.DRAW_START ? new HashMap<>(sharedStock) : sharedStock;
        Reply<Snapshot> rejection = switch (command.action()) {
            case PACK1_START -> start(plan, CUT_READY, PACK1_ACTIVE, session);
            case PACK1_FINISH -> finishPack1(plan, command);
            case DRAW_START -> startDrawing(plan, session, command, stock);
            case DRAW_FINISH -> finishDrawing(plan, command.quantity());
            case PACK2_START -> startPack2(plan, session);
            case PACK2_FINISH -> finishPack2(plan, command.quantity());
            case STANDARD_PACK_START -> startStandardPack(plan, session);
            case STANDARD_PACK_FINISH -> finishStandardPack(plan, command);
        };
        if (rejection != null) return rejection;
        record(plan, session, command.action(), null, null, null);
        Snapshot snapshot = plan.snapshot();
        plan.receipts.put(request, new Receipt(command, snapshot));
        sharedStock = Map.copyOf(stock);
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

    private Reply<Snapshot> startDrawing(Plan plan, Session session, Command command, Map<SharedKey, BigDecimal> shared) {
        if (plan.state != CUT_READY && plan.state != DRAW_READY) return error(409, "INVALID_STATE");
        if (command.scanToken() == null || command.scanToken().isBlank()) {
            return error(422, "SCAN_TOKEN_REQUIRED");
        }
        Permit permit = plan.permits.get(session.terminal());
        if (permit == null || !permit.token().equals(command.scanToken())) {
            return error(409, "SCAN_TOKEN_INVALID");
        }
        var rejection = deduct(plan, command.inputs(), shared);
        if (rejection != null) return rejection;
        plan.bypass = permit.bypass();
        plan.state = DRAW_ACTIVE;
        plan.owner = session.terminal();
        return null;
    }

    private Reply<Snapshot> deduct(Plan plan, List<Input> inputs, Map<SharedKey, BigDecimal> shared) {
        if (inputs.isEmpty()) return error(422, "INPUT_REQUIRED");
        Map<StockKey, BigDecimal> totals = new HashMap<>();
        for (Input input : inputs) {
            if (input.stock() == null || !inputBin(input.stock().bin()) || !positive(input.quantity())) {
                return error(422, "INVALID_INPUT");
            }
            totals.merge(input.stock(), input.quantity(), BigDecimal::add);
        }
        for (var entry : totals.entrySet()) {
            var key = SharedKey.of(plan.seed.key(), entry.getKey());
            var available = shared.getOrDefault(key, plan.balance(entry.getKey()));
            if (entry.getValue().compareTo(available) > 0) return error(422, "INSUFFICIENT_INPUT");
        }
        totals.forEach((stock, quantity) -> {
            var key = SharedKey.of(plan.seed.key(), stock);
            if (shared.containsKey(key)) shared.put(key, shared.get(key).subtract(quantity));
            else plan.add(stock, quantity.negate());
        });
        plan.drawingInputs = totals.entrySet().stream()
                .sorted(Map.Entry.comparingByKey(Comparator.comparing(StockKey::lot)
                        .thenComparing(StockKey::bin).thenComparing(StockKey::item)))
                .map(entry -> new Input(entry.getKey(), entry.getValue().setScale(3)))
                .toList();
        return null;
    }

    public synchronized List<String> groups(Session session) {
        if (!validSession(session)) return List.of();
        return groups.values().stream().filter(group -> inScope(session, group.members().get(0)))
                .map(GroupSeed::id).toList();
    }

    public synchronized Reply<GroupView> group(Session session, String id) {
        if (!validSession(session)) return error(401, "INVALID_SESSION");
        var group = groups.get(id);
        if (group == null) return error(404, "GROUP_NOT_FOUND");
        if (!inScope(session, group.members().get(0))) return error(403, "PLAN_OUT_OF_SCOPE");
        return ok(groupView(group, plans, sharedStock));
    }

    public synchronized Reply<GroupView> executeGroup(Session session, String id, GroupCommand command) {
        if (!validSession(session)) return error(401, "INVALID_SESSION");
        var group = groups.get(id);
        if (group == null) return error(404, "GROUP_NOT_FOUND");
        if (!inScope(session, group.members().get(0))) return error(403, "PLAN_OUT_OF_SCOPE");
        if (command == null || !present(command.requestId())) return error(422, "REQUEST_ID_REQUIRED");
        var lines = new HashMap<PlanKey, GroupLine>();
        for (var line : command.members()) {
            if (!group.members().contains(line.key()) || lines.putIfAbsent(line.key(), line) != null) {
                return error(422, "INVALID_GROUP_MEMBERS");
            }
        }
        if (lines.size() != group.members().size()) return error(422, "INVALID_GROUP_MEMBERS");
        command = new GroupCommand(command.action(), command.requestId(), group.members().stream().map(key -> {
            var line = lines.get(key);
            return new GroupLine(key, line.expectedVersion(), normalized(line.inputs()), normalized(line.goodQty()), line.confirmSkip());
        }).toList());
        var request = new GroupRequest(id, new RequestKey(session.terminal(), command.requestId()));
        var receipt = groupReceipts.get(request);
        if (receipt != null) {
            return receipt.command().equals(command) ? ok(receipt.result()) : error(409, "REQUEST_ID_REUSED");
        }
        for (var key : group.members()) {
            var owner = plans.get(key).owner;
            if (owner != null && !owner.equals(session.terminal())) return error(409, "TERMINAL_MISMATCH");
        }
        for (var line : command.members()) {
            if (plans.get(line.key()).version != line.expectedVersion()) return error(409, "STALE_VERSION");
        }
        if (command.action() == null) return error(422, "ACTION_REQUIRED");

        var updatedPlans = new LinkedHashMap<>(plans);
        var updatedStock = new HashMap<>(sharedStock);
        int lineNumber = 0;
        for (var line : command.members()) {
            var updated = new Plan(plans.get(line.key()));
            if (command.action() == GroupAction.DRAW_START) {
                boolean bypass = updated.state == CUT_READY && line.confirmSkip();
                if (updated.state != DRAW_READY && !bypass) return error(409, "GROUP_NOT_DRAW_READY");
                if (line.confirmSkip() && (!bypass || !line.inputs().isEmpty())) return error(422, "INVALID_SKIP_INPUT");
                if (line.goodQty() != null) return error(422, "UNEXPECTED_GROUP_QUANTITY");
                var localCandidate = updated.output(Bin.DRAWING);
                if (line.inputs().stream().anyMatch(input -> input.stock() != null
                        && !localCandidate.equals(input.stock())
                        && (input.stock().bin() == Bin.REMNANT
                                || !updatedStock.containsKey(SharedKey.of(line.key(), input.stock()))))) {
                    return error(422, "INVALID_GROUP_CANDIDATE");
                }
                List<Input> inputs = line.inputs();
                if (bypass) {
                    var automatic = autoRemnant(updated, updatedStock);
                    if (automatic == null) return error(422, "GROUP_REMNANT_UNAVAILABLE");
                    inputs = List.of(automatic);
                }
                var rejection = deduct(updated, inputs, updatedStock);
                if (rejection != null) return error(rejection.status(), rejection.error());
                start(updated, updated.state, DRAW_ACTIVE, session);
                updated.bypass = bypass;
                updated.activeGroup = id;
                record(updated, session, Action.DRAW_START, null, null, null);
            } else {
                if (!id.equals(updated.activeGroup)) return error(409, "GROUP_NOT_ACTIVE");
                if (line.confirmSkip() || !line.inputs().isEmpty()) return error(422, "UNEXPECTED_GROUP_INPUT");
                var rejection = finishDrawing(updated, line.goodQty());
                if (rejection != null) return error(rejection.status(), rejection.error());
                updated.activeGroup = null;
                updated.groupResult = new GroupResult("DAILY-GROUP-" + id, "MOVE-GROUP-" + id, ++lineNumber);
                record(updated, session, Action.DRAW_FINISH, updated.groupResult.drawingDailyId(),
                        updated.groupResult.movementId(), updated.groupResult.movementLine());
            }
            updatedPlans.put(line.key(), updated);
        }
        var result = groupView(group, updatedPlans, updatedStock);
        sharedStock = Map.copyOf(updatedStock);
        plans.putAll(updatedPlans);
        groupReceipts.put(request, new GroupReceipt(command, result));
        return ok(result);
    }

    private GroupView groupView(GroupSeed group, Map<PlanKey, Plan> current, Map<SharedKey, BigDecimal> shared) {
        var candidates = new ArrayList<GroupCandidate>();
        var first = group.members().get(0);
        var ready = group.members().stream().filter(key -> current.get(key).state == DRAW_READY).toList();
        shared.entrySet().stream()
                .filter(entry -> entry.getKey().stock().bin() != Bin.REMNANT
                        && entry.getKey().equals(SharedKey.of(first, entry.getKey().stock())))
                .sorted(Map.Entry.comparingByKey(Comparator.comparing((SharedKey key) -> key.stock().lot())
                        .thenComparing(key -> key.stock().bin()).thenComparing(key -> key.stock().item())))
                .forEach(entry -> candidates.add(new GroupCandidate(entry.getKey().stock(), entry.getValue(), ready)));
        var local = new LinkedHashMap<StockKey, List<PlanKey>>();
        for (var key : ready) {
            var plan = current.get(key);
            var stock = plan.output(Bin.DRAWING);
            if (positive(plan.balance(stock))) local.computeIfAbsent(stock, ignored -> new ArrayList<>()).add(key);
        }
        local.forEach((stock, keys) -> candidates.add(new GroupCandidate(stock,
                keys.stream().map(key -> current.get(key).balance(stock)).reduce(BigDecimal.ZERO, BigDecimal::add),
                List.copyOf(keys))));
        return new GroupView(group.id(), group.members().stream()
                .map(key -> {
                    var plan = current.get(key);
                    return new GroupMember(key, plan.snapshot(), plan.groupResult, plan.drawingInputs,
                            plan.state == CUT_READY ? autoRemnant(plan, shared) : null);
                }).toList(), List.copyOf(candidates));
    }

    private static boolean drawingOrder(Plan plan) {
        return plan.seed.type() == OrderType.DRAWING || plan.seed.type() == OrderType.DRAWING_DEFERRED;
    }

    private static Input autoRemnant(Plan plan, Map<SharedKey, BigDecimal> shared) {
        var profile = plan.seed.remnantStock();
        if (profile == null) return null;
        return java.util.stream.Stream.concat(
                        plan.stock.entrySet().stream(),
                        shared.entrySet().stream()
                                .filter(entry -> entry.getKey().equals(SharedKey.of(plan.seed.key(), entry.getKey().stock())))
                                .map(entry -> Map.entry(entry.getKey().stock(), entry.getValue())))
                .filter(entry -> entry.getKey().bin() == Bin.REMNANT
                        && entry.getKey().item().equals(profile.item())
                        && entry.getValue().compareTo(BigDecimal.ONE) >= 0)
                .map(Map.Entry::getKey)
                .min(Comparator.comparing(StockKey::lot))
                .map(stock -> new Input(stock, BigDecimal.ONE)).orElse(null);
    }

    private void record(Plan plan, Session session, Action action, String dailyId, String movementId, Integer movementLine) {
        plan.version++;
        plan.permits.clear();
        if (action == Action.PACK2_START) return;
        if (action == Action.DRAW_FINISH && dailyId == null) dailyId = "DAILY-" + plan.seed.key();
        plan.records.add(new StageRecord(action, session.operator(), session.terminal(), plan.version,
                clock.instant(), dailyId, plan.shipment == null ? null : plan.shipment.id(), movementId, movementLine));
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

        return completePacking(plan, product, quantity);
    }

    private Reply<Snapshot> startStandardPack(Plan plan, Session session) {
        var rejection = start(plan, CUT_READY, STANDARD_PACK_ACTIVE, session);
        if (rejection == null) plan.pack2Started = clock.instant();
        return rejection;
    }

    private Reply<Snapshot> finishStandardPack(Plan plan, Command command) {
        if (plan.state == SHIP_READY) return error(409, "ALREADY_PACKED");
        if (plan.state != STANDARD_PACK_ACTIVE) return error(409, "INVALID_STATE");
        var stock = plan.seed.cutStock();
        if (!stock.equals(command.stock())) return error(422, "INVALID_PACK_LOT");
        var available = plan.balance(stock).min(plan.seed.orderQuantity());
        var quantity = command.quantity();
        if (!positive(quantity)) return error(422, "INVALID_QUANTITY");
        if (quantity.compareTo(available) > 0) return error(422, "PACK_QTY_EXCEEDED");
        if (quantity.compareTo(available) < 0) return error(422, "PACK_QTY_MUST_MATCH_REMAINING");
        return completePacking(plan, stock, quantity);
    }

    private Reply<Snapshot> completePacking(Plan plan, StockKey product, BigDecimal quantity) {
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
        if (!validSession(session) || !inScope(session, key) || !plans.containsKey(key)) return new Audit(Map.of(), List.of(), List.of());
        var plan = plans.get(key);
        return new Audit(Map.copyOf(plan.stock), List.copyOf(plan.records), plan.drawingInputs);
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

    private static boolean sameSite(PlanKey left, PlanKey right) {
        return left.factory().equals(right.factory()) && left.site().equals(right.site());
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
        var inputs = normalized(command.inputs());
        return new Command(command.action(), command.expectedVersion(), command.requestId(), command.stock(),
                normalized(command.quantity()), command.scanToken(), inputs);
    }

    private static List<Input> normalized(List<Input> inputs) {
        return inputs.stream().map(input -> new Input(input.stock(), normalized(input.quantity()))).toList();
    }

    private static <T> Reply<T> ok(T value) {
        return new Reply<>(200, null, value);
    }

    private static <T> Reply<T> error(int status, String code) {
        return new Reply<>(status, code, null);
    }
}
