package com.shinjin.pop.workorders;

import java.math.BigDecimal;
import java.time.LocalDate;
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

    record Detail(Summary plan, List<Step> steps) {}

    private record ScopedPlan(String terminalId, Detail detail) {}

    private static final LocalDate PLAN_DATE = LocalDate.of(2026, 11, 25);

    private final List<ScopedPlan> plans = List.of(
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
                    List.of(new Step("가공 확인", State.COMPLETE), new Step("포장", State.WAITING)))));

    List<Summary> list(String terminalId, State status) {
        return plans.stream()
                .filter(row -> row.terminalId().equals(terminalId))
                .map(row -> row.detail().plan())
                .filter(plan -> status == null || plan.status() == status)
                .toList();
    }

    Optional<Detail> find(String terminalId, LocalDate date, int sequence) {
        return plans.stream()
                .filter(row -> row.terminalId().equals(terminalId))
                .map(ScopedPlan::detail)
                .filter(detail -> detail.plan().planDate().equals(date)
                        && detail.plan().planSequence() == sequence)
                .findFirst();
    }
}
