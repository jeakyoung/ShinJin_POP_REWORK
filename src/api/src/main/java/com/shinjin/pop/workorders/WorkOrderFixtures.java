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
    enum State { WAITING, IN_PROGRESS, COMPLETE }

    record Summary(LocalDate planDate, int planSequence, String orderNumber, int orderLine,
            String itemName, String process, BigDecimal plannedQuantity, State status) {}

    record Step(String name, State status) {}

    record Detail(Summary plan, List<Step> steps, BigDecimal actualQuantity, String startedBy, String completedBy) {
        Detail(Summary plan, List<Step> steps) {
            this(plan, steps, null, null, null);
        }
    }

    enum Action { START, COMPLETE }

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
            Action action, BigDecimal actualQuantity, String workerId) {
        for (int index = 0; index < plans.size(); index++) {
            var current = plans.get(index);
            var plan = current.detail().plan();
            if (current.terminalId().equals(terminalId) && plan.planDate().equals(date)
                    && plan.planSequence() == sequence) {
                var updated = transition(current.detail(), action, actualQuantity, workerId);
                plans.set(index, new ScopedPlan(terminalId, updated));
                return Optional.of(updated);
            }
        }
        return Optional.empty();
    }

    private Detail transition(Detail current, Action action, BigDecimal actualQuantity, String workerId) {
        var plan = current.plan();
        boolean starting = action == Action.START;
        State expected = starting ? State.WAITING : State.IN_PROGRESS;
        State next = starting ? State.IN_PROGRESS : State.COMPLETE;
        if (plan.status() != expected) {
            throw new IllegalStateException("Work order is in a different state");
        }

        if (starting ? actualQuantity != null : !isValidQuantity(actualQuantity, plan.plannedQuantity())) {
            throw new IllegalArgumentException("Invalid actual quantity for the action");
        }

        var summary = new Summary(plan.planDate(), plan.planSequence(), plan.orderNumber(),
                plan.orderLine(), plan.itemName(), plan.process(), plan.plannedQuantity(), next);
        var steps = current.steps().stream()
                .map(step -> step.name().equals(plan.process()) ? new Step(step.name(), next) : step)
                .toList();
        return new Detail(summary, steps, actualQuantity,
                starting ? workerId : current.startedBy(), starting ? null : workerId);
    }

    private boolean isValidQuantity(BigDecimal actual, BigDecimal planned) {
        return actual != null && actual.signum() > 0 && actual.compareTo(planned) <= 0
                && actual.stripTrailingZeros().scale() <= 3;
    }
}
