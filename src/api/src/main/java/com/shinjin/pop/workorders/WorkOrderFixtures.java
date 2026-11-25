package com.shinjin.pop.workorders;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("demo")
class WorkOrderFixtures {
    enum State { WAITING, IN_PROGRESS, PAUSED, COMPLETE }

    record Summary(LocalDate planDate, int planSequence, String orderNumber, int orderLine,
            String itemName, String process, BigDecimal plannedQuantity, State status) {}

    record Step(String name, State status) {}

    record Position(String warehouse, String location) {}
    record StockPosition(Position position, BigDecimal availableQuantity) {}
    record Material(String lotCode, BigDecimal issuedQuantity, List<StockPosition> positions) {}
    record MaterialEvent(Action action, String lotCode, BigDecimal quantity, Position position,
            String workerId, long revision) {}

    record Detail(Summary plan, List<Step> steps, BigDecimal actualQuantity, String startedBy,
            String completedBy, long revision, List<Material> materials, Position returnPosition, List<MaterialEvent> materialEvents) {}

    private record Order(Summary plan, List<Step> steps, BigDecimal actualQuantity, String startedBy, String completedBy, long revision,
            Map<String, BigDecimal> issued, List<MaterialEvent> events) {
        Order(Summary plan, List<Step> steps) {
            this(plan, steps, null, null, null, 0, Map.of(), List.of());
        }
    }

    enum Action { START, PAUSE, RESUME, CANCEL_START, COMPLETE, ISSUE_MATERIAL, RETURN_MATERIAL }

    private record ScopedPlan(String terminalId, Order order) {}

    private static final LocalDate PLAN_DATE = LocalDate.of(2026, 11, 25);

    private Inventory inventory = new Inventory(List.of(
            new ScopedPlan("DEMO-A", new Order(
                    new Summary(PLAN_DATE, 101, "DEMO-ORDER-11", 1, "샘플 강판 A", "절단",
                            new BigDecimal("12.5"), State.WAITING),
                    List.of(new Step("소재 준비", State.COMPLETE), new Step("절단", State.WAITING)))),
            new ScopedPlan("DEMO-A", new Order(
                    new Summary(PLAN_DATE, 102, "DEMO-ORDER-12", 2, "샘플 강판 B", "절단",
                            new BigDecimal("8"), State.IN_PROGRESS),
                    List.of(new Step("소재 준비", State.COMPLETE), new Step("절단", State.IN_PROGRESS)))),
            new ScopedPlan("DEMO-B", new Order(
                    new Summary(PLAN_DATE, 201, "DEMO-ORDER-21", 1, "샘플 제품 C", "포장",
                            new BigDecimal("4"), State.WAITING),
                    List.of(new Step("가공 확인", State.COMPLETE), new Step("포장", State.WAITING))))), initialStock());

    private record Lot(String terminalId, String code, Position position) {}
    private record Inventory(List<ScopedPlan> plans, Map<Lot, BigDecimal> stock) {}

    private static final Map<String, Position> RETURN_POSITIONS = Map.of(
            "DEMO-A", new Position("WH-RETURN-A", "RET-01"),
            "DEMO-B", new Position("WH-RETURN-B", "RET-01"));

    private static Map<Lot, BigDecimal> initialStock() {
        return Map.of(
                new Lot("DEMO-A", "LOT-A-01", new Position("WH-A", "BIN-01")), new BigDecimal("10.000"),
                new Lot("DEMO-A", "LOT-A-01", new Position("WH-A", "BIN-02")), new BigDecimal("4.000"),
                new Lot("DEMO-A", "LOT-A-01", new Position("WH-A2", "BIN-01")), new BigDecimal("2.000"),
                new Lot("DEMO-A", "LOT-A-02", new Position("WH-A", "BIN-02")), new BigDecimal("5.500"),
                new Lot("DEMO-B", "LOT-B-01", new Position("WH-B", "BIN-01")), new BigDecimal("8.000"));
    }

    synchronized List<Summary> list(String terminalId, State status) {
        return inventory.plans().stream()
                .filter(row -> row.terminalId().equals(terminalId))
                .map(row -> row.order().plan())
                .filter(plan -> status == null || plan.status() == status)
                .toList();
    }

    synchronized Optional<Detail> find(String terminalId, LocalDate date, int sequence) {
        return inventory.plans().stream()
                .filter(row -> row.terminalId().equals(terminalId))
                .map(ScopedPlan::order)
                .filter(detail -> detail.plan().planDate().equals(date)
                        && detail.plan().planSequence() == sequence)
                .findFirst()
                .map(order -> detail(terminalId, order, inventory.stock()));
    }

    synchronized Optional<Detail> apply(String terminalId, LocalDate date, int sequence,
            Action action, BigDecimal actualQuantity, long expectedRevision, String workerId,
            String lotCode, BigDecimal quantity, String warehouse, String location) {
        var plans = inventory.plans();
        for (int index = 0; index < plans.size(); index++) {
            var current = plans.get(index);
            var order = current.order();
            var plan = order.plan();
            if (current.terminalId().equals(terminalId) && plan.planDate().equals(date)
                    && plan.planSequence() == sequence) {
                if (order.revision() != expectedRevision) {
                    throw new IllegalStateException("Work order revision changed");
                }
                boolean materialAction = action == Action.ISSUE_MATERIAL || action == Action.RETURN_MATERIAL;
                if (materialAction ? actualQuantity != null : lotCode != null || quantity != null || warehouse != null || location != null) {
                    throw new IllegalArgumentException("Unexpected fields for the action");
                }
                var stock = materialAction ? new HashMap<>(inventory.stock()) : inventory.stock();
                var updated = materialAction
                        ? moveMaterial(terminalId, workerId, order, action, lotCode, quantity,
                                warehouse, location, stock)
                        : transition(order, action, actualQuantity, workerId);
                var updatedPlans = new ArrayList<>(plans);
                updatedPlans.set(index, new ScopedPlan(terminalId, updated));
                var result = detail(terminalId, updated, stock);
                inventory = new Inventory(List.copyOf(updatedPlans), Map.copyOf(stock));
                return Optional.of(result);
            }
        }
        return Optional.empty();
    }

    private Detail detail(String terminalId, Order order, Map<Lot, BigDecimal> stock) {
        var terminalLots = stock.keySet().stream()
                .filter(lot -> lot.terminalId().equals(terminalId))
                .sorted(Comparator.comparing(Lot::code)
                        .thenComparing(lot -> lot.position().warehouse())
                        .thenComparing(lot -> lot.position().location()))
                .toList();
        var positionsByLot = new LinkedHashMap<String, List<StockPosition>>();
        for (var lot : terminalLots) {
            positionsByLot.computeIfAbsent(lot.code(), code -> new ArrayList<>())
                    .add(new StockPosition(lot.position(), stock.get(lot)));
        }
        var materials = positionsByLot.entrySet().stream()
                .map(entry -> new Material(entry.getKey(), order.issued().getOrDefault(entry.getKey(), BigDecimal.ZERO),
                        List.copyOf(entry.getValue())))
                .toList();
        return new Detail(order.plan(), order.steps(), order.actualQuantity(), order.startedBy(),
                order.completedBy(), order.revision(), materials, RETURN_POSITIONS.get(terminalId), order.events());
    }

    private Order moveMaterial(String terminalId, String workerId, Order current, Action action, String lotCode,
            BigDecimal quantity, String warehouse, String location, Map<Lot, BigDecimal> stock) {
        if (lotCode == null || lotCode.isBlank() || quantity == null || quantity.signum() <= 0
                || quantity.stripTrailingZeros().scale() > 3) {
            throw new IllegalArgumentException("Enter a LOT and a positive quantity with up to three decimal places");
        }

        boolean issue = action == Action.ISSUE_MATERIAL;
        var state = current.plan().status();
        if (state == State.COMPLETE || (!issue && state == State.WAITING)) {
            throw new IllegalStateException("Work order state does not allow this material action");
        }
        if (issue ? warehouse == null || warehouse.isBlank() || location == null || location.isBlank()
                : warehouse != null || location != null) {
            throw new IllegalArgumentException("Only material issues require a stock location");
        }

        var position = issue ? new Position(warehouse, location) : RETURN_POSITIONS.get(terminalId);
        var lot = new Lot(terminalId, lotCode, position);
        var available = stock.getOrDefault(lot, BigDecimal.ZERO);
        if (issue ? !stock.containsKey(lot)
                : stock.keySet().stream().noneMatch(key -> key.terminalId().equals(terminalId) && key.code().equals(lotCode))) {
            throw new IllegalArgumentException("LOT or stock location unavailable at this terminal");
        }
        var issued = current.issued().getOrDefault(lotCode, BigDecimal.ZERO);
        if (quantity.compareTo(issue ? available : issued) > 0) {
            throw new IllegalArgumentException(issue ? "Quantity exceeds LOT stock at this location" : "Quantity exceeds issued material");
        }

        var normalized = quantity.setScale(3);
        var delta = issue ? normalized : normalized.negate();
        var balances = new HashMap<>(current.issued());
        var remaining = issued.add(delta);
        if (remaining.signum() == 0) {
            balances.remove(lotCode);
        } else {
            balances.put(lotCode, remaining);
        }
        long revision = current.revision() + 1;
        var events = new ArrayList<>(current.events());
        events.add(new MaterialEvent(action, lotCode, normalized, position, workerId, revision));
        stock.put(lot, available.subtract(delta));
        return new Order(current.plan(), current.steps(), current.actualQuantity(), current.startedBy(),
                current.completedBy(), revision, Map.copyOf(balances), List.copyOf(events));
    }

    private Order transition(Order current, Action action, BigDecimal actualQuantity, String workerId) {
        var plan = current.plan();
        boolean allowed = switch (action) {
            case START -> plan.status() == State.WAITING;
            case PAUSE, COMPLETE -> plan.status() == State.IN_PROGRESS;
            case RESUME -> plan.status() == State.PAUSED;
            case CANCEL_START -> plan.status() == State.IN_PROGRESS || plan.status() == State.PAUSED;
            case ISSUE_MATERIAL, RETURN_MATERIAL -> false;
        };
        if (!allowed) {
            throw new IllegalStateException("Work order is in a different state or revision");
        }

        if (action == Action.COMPLETE ? !isValidQuantity(actualQuantity, plan.plannedQuantity()) : actualQuantity != null) {
            throw new IllegalArgumentException("Invalid actual quantity for the action");
        }

        if (action == Action.START && current.issued().isEmpty()) {
            throw new IllegalStateException("Issue material before starting work");
        }

        State next = switch (action) {
            case START, RESUME -> State.IN_PROGRESS;
            case PAUSE -> State.PAUSED;
            case CANCEL_START -> State.WAITING;
            case COMPLETE -> State.COMPLETE;
            case ISSUE_MATERIAL, RETURN_MATERIAL -> throw new IllegalStateException("Not a work-state action");
        };

        var summary = new Summary(plan.planDate(), plan.planSequence(), plan.orderNumber(),
                plan.orderLine(), plan.itemName(), plan.process(), plan.plannedQuantity(), next);
        var steps = current.steps().stream()
                .map(step -> step.name().equals(plan.process()) ? new Step(step.name(), next) : step)
                .toList();
        String startedBy = switch (action) {
            case START -> workerId;
            case CANCEL_START -> null;
            default -> current.startedBy();
        };
        return new Order(summary, steps, actualQuantity, startedBy,
                action == Action.COMPLETE ? workerId : null, current.revision() + 1, current.issued(), current.events());
    }

    private boolean isValidQuantity(BigDecimal actual, BigDecimal planned) {
        return actual != null && actual.signum() > 0 && actual.compareTo(planned) <= 0
                && actual.stripTrailingZeros().scale() <= 3;
    }
}
