package com.shinjin.pop.history;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import org.springframework.stereotype.Component;

@Component
public class WorkHistoryFixtures {
    static final LocalDate SAMPLE_DATE = LocalDate.of(2026, 11, 25);

    public record Worker(String id, String name, String department) {}

    public record Terminal(
            String id, String name, String factory, String workCenter, List<Worker> workers) {}

    public record Entry(
            String id, String orderNumber, String itemName, String processName,
            BigDecimal plannedQuantity, BigDecimal actualQuantity, String movement,
            String warehouse, String startedAt, String finishedAt) {}

    record Work(String terminalId, String workerId, LocalDate date, Entry entry) {}

    private final List<Terminal> terminals = List.of(
            new Terminal("DEMO-A", "POP A", "샘플 1공장", "절단 작업장", List.of(
                    new Worker("DEMO-W01", "샘플 작업자 A", "생산 1팀"),
                    new Worker("DEMO-W02", "샘플 작업자 B", "생산 1팀"))),
            new Terminal("DEMO-B", "POP B", "샘플 2공장", "포장 작업장", List.of(
                    new Worker("DEMO-W03", "샘플 작업자 C", "생산 2팀"))),
            new Terminal("DEMO-A2", "POP A2", "\uc0d8\ud50c 1\uacf5\uc7a5", "\ud3ec\uc7a5 \uc791\uc5c5\uc7a5", List.of(
                    new Worker("DEMO-W04", "\uc0d8\ud50c \uc791\uc5c5\uc790 D", "\uc0dd\uc0b0 1\ud300"))));

    private final List<Work> work = List.of(
            new Work("DEMO-A", "DEMO-W01", SAMPLE_DATE, new Entry(
                    "DEMO-H01", "DEMO-ORDER-01", "샘플 강판 A", "절단",
                    new BigDecimal("12"), new BigDecimal("11.5"), "입고", "샘플 창고 A", "09:10", "09:48")),
            new Work("DEMO-A", "DEMO-W02", SAMPLE_DATE, new Entry(
                    "DEMO-H02", "DEMO-ORDER-02", "샘플 강판 B", "절단",
                    new BigDecimal("10"), new BigDecimal("10"), "입고", "샘플 창고 A", "10:15", "10:55")),
            new Work("DEMO-B", "DEMO-W03", SAMPLE_DATE, new Entry(
                    "DEMO-H03", "DEMO-ORDER-03", "샘플 제품 C", "포장",
                    new BigDecimal("8"), new BigDecimal("8"), "입고", "샘플 창고 B", "14:10", "14:42")));

    List<Terminal> terminals() {
        return terminals;
    }

    List<Entry> find(String terminalId, String workerId, LocalDate date) {
        return work.stream()
                .filter(row -> row.terminalId().equals(terminalId)
                        && row.workerId().equals(workerId) && row.date().equals(date))
                .map(Work::entry)
                .toList();
    }
}
