package com.shinjin.pop.workorders;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
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

    record Detail(Summary plan, List<Step> steps, BigDecimal actualQuantity, String startedBy, String completedBy, long revision) {
        Detail(Summary plan, List<Step> steps) {
            this(plan, steps, null, null, null, 0);
        }
    }

    enum Action { START, PAUSE, RESUME, CANCEL_START, COMPLETE }

    private record ScopedPlan(String terminalId, Detail detail) {}

    private static final LocalDate PLAN_DATE = LocalDate.of(2026, 11, 25);

    private final List<ScopedPlan> plans = new ArrayList<>(List.of(
            new ScopedPlan("DEMO-A", new Detail(
                    new Summary(PLAN_DATE, 101, "DEMO-ORDER-11", 1, "샘플 강판 A", "절단",
                            new BigDecimal("12.5"), State.WAITING),
                    List.of(new Step("소재 준비", State.COMPLETE), new Step("절단", State.WAITING)))),
            new ScopedPlan("DEMO-A", new Detail(
                    new Summary(PLAN_DATE, 102, "DEMO-ORDER-12", 2, "샘플 강판 B", "절단",
                            new BigDecimal("8"), State.IN_PROGRESS),
                    List.of(new Step("소재 준비", State.COMPLETE), new Step("절단", State.IN_PROGRESS)))),
            new ScopedPlan("DEMO-B", new Detail(
                    new Summary(PLAN_DATE, 201, "DEMO-ORDER-21", 1, "샘플 제품 C", "포장",
                            new BigDecimal("4"), State.WAITING),
                    List.of(new Step("가공 확인", State.COMPLETE), new Step("포장", State.WAITING))))));

    synchronized List<Summary> list(String terminalId, State status) {
        return plans.stream()
                .filter(row -> row.terminalId().equals(terminalId))
                .map(row -> row.detail().plan())
                .filter(plan -> status == null || plan.status() == status)
                .toList();
    }

    synchronized Optional<Detail> find(String terminalId, LocalDate date, int sequence) {
        return plans.stream()
                .filter(row -> row.terminalId().equals(terminalId))
                .map(ScopedPlan::detail)
                .filter(detail -> detail.plan().planDate().equals(date)
                        && detail.plan().planSequence() == sequence)
                .findFirst();
    }

    synchronized Optional<Detail> apply(String terminalId, LocalDate date, int sequence,
            Action action, BigDecimal actualQuantity, long expectedRevision, String workerId) {
        for (int index = 0; index < plans.size(); index++) {
            var current = plans.get(index);
            var plan = current.detail().plan();
            if (current.terminalId().equals(terminalId) && plan.planDate().equals(date)
                    && plan.planSequence() == sequence) {
                var updated = transition(current.detail(), action, actualQuantity, expectedRevision, workerId);
                plans.set(index, new ScopedPlan(terminalId, updated));
                return Optional.of(updated);
            }
        }
        return Optional.empty();
    }

    private Detail transition(Detail current, Action action, BigDecimal actualQuantity, long expectedRevision, String workerId) {
        var plan = current.plan();
        boolean allowed = switch (action) {
            case START -> plan.status() == State.WAITING;
            case PAUSE, COMPLETE -> plan.status() == State.IN_PROGRESS;
            case RESUME -> plan.status() == State.PAUSED;
            case CANCEL_START -> plan.status() == State.IN_PROGRESS || plan.status() == State.PAUSED;
        };
        if (!allowed || current.revision() != expectedRevision) {
            throw new IllegalStateException("Work order is in a different state or revision");
        }

        if (action == Action.COMPLETE ? !isValidQuantity(actualQuantity, plan.plannedQuantity()) : actualQuantity != null) {
            throw new IllegalArgumentException("Invalid actual quantity for the action");
        }

        State next = switch (action) {
            case START, RESUME -> State.IN_PROGRESS;
            case PAUSE -> State.PAUSED;
            case CANCEL_START -> State.WAITING;
            case COMPLETE -> State.COMPLETE;
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
        return new Detail(summary, steps, actualQuantity, startedBy,
                action == Action.COMPLETE ? workerId : null, current.revision() + 1);
    }

    private boolean isValidQuantity(BigDecimal actual, BigDecimal planned) {
        return actual != null && actual.signum() > 0 && actual.compareTo(planned) <= 0
                && actual.stripTrailingZeros().scale() <= 3;
    }
}
