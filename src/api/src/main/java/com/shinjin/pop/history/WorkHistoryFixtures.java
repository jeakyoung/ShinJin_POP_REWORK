package com.shinjin.pop.history;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;

import org.springframework.stereotype.Component;

@Profile("demo")
@Component
public class WorkHistoryFixtures {

    public record Worker(String id, String name, String department) {}

    public record Terminal(
            String id, String name, String factory, String workCenter, List<Worker> workers) {}

    public record Entry(
            String id, String orderNumber, String itemName, String processName,
            BigDecimal plannedQuantity, BigDecimal actualQuantity, String movement,
            String warehouse, String startedAt, String finishedAt, String customer, String itemKind,
            String material, String partNo, BigDecimal thickness, BigDecimal width, BigDecimal length,
            String productionGroup, String checked) {}

    record Work(String terminalId, String workerId, LocalDate date, Entry entry) {}

    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    public record Stage(String process, String warehouse, String processCode, String warehouseCode) {
        public Stage(String process, String warehouse) { this(process, warehouse, null, null); }
    }
    public record Station(String profile, String center, List<Integer> slots, List<Stage> stages, String inputLot, int inputQty) {
        public boolean groupCenter() { return "005".equals(center) || "105".equals(center); }
        public boolean packMenu() { return slots.contains(6); }
        public boolean packAuto() {
            return slots.size() == 1 && ("006".equals(center) || "106".equals(center) || packMenu()) && !groupCenter();
        }
        public String initialView() {
            if (groupCenter() || slots.size() != 1) return "home";
            if (packAuto()) return "packing";
            return "003".equals(center) || "103".equals(center) ? "basket" : "orders";
        }
    }
    private record Dataset(LocalDate sampleDate, List<Terminal> terminals, List<Work> work, Map<String, Station> stations, Map<String, MenuProcesses> menuProcesses) {}
    public record MenuProcesses(Map<Integer,String> slots, Map<String,String> settings) {}

    private final List<Terminal> terminals;
    private final List<Work> work;
    private final LocalDate sampleDate;
    private final Map<String, Station> stations;

    private final Map<String,MenuProcesses> menuProcesses;
    public MenuProcesses menuProcesses(String terminal) { return menuProcesses.getOrDefault(terminal,new MenuProcesses(Map.of(),Map.of())); }

    public WorkHistoryFixtures() { this(""); }

    @Autowired
    public WorkHistoryFixtures(@Value("${shinjin.demo.dataset:}") String path) {
        try (InputStream in = path.isEmpty() ? WorkHistoryFixtures.class.getResourceAsStream("/work-history-default.json")
                : Files.newInputStream(Path.of(path))) {
            if (in == null) throw new IOException("Bundled dataset missing");
            var data = JsonMapper.builder().build().readValue(in, Dataset.class);
            menuProcesses = data.menuProcesses() == null ? Map.of() : Map.copyOf(data.menuProcesses());
            sampleDate = Objects.requireNonNull(data.sampleDate());
            terminals = data.terminals().stream().map(t -> new Terminal(t.id(), t.name(), t.factory(),
                    t.workCenter(), List.copyOf(t.workers()))).toList();
            work = List.copyOf(data.work());
            stations = data.stations() == null ? Map.of() : Map.copyOf(data.stations());
            var assignments = new HashMap<String, Set<String>>();
            for (Terminal t : terminals) {
                var ids = new HashSet<String>();
                require(text(t.id()) && text(t.name()) && text(t.factory()) && text(t.workCenter())
                        && assignments.putIfAbsent(t.id(), ids) == null);
                for (Worker w : t.workers()) require(text(w.id()) && text(w.name()) && text(w.department()) && ids.add(w.id()));
            }
            for (Work row : work) require(row.date() != null && row.entry() != null && text(row.entry().id())
                    && assignments.getOrDefault(row.terminalId(), Set.of()).contains(row.workerId())
                    && row.entry().plannedQuantity() != null && row.entry().actualQuantity() != null);
            stations.forEach((id, st) -> {
                require(assignments.containsKey(id) && text(st.profile()) && text(st.center()) && st.slots() != null
                        && st.slots().stream().allMatch(n -> n != null && n >= 1 && n <= 6)
                        && new HashSet<>(st.slots()).size() == st.slots().size() && st.stages() != null
                        && st.stages().stream().allMatch(stage -> text(stage.process()) && text(stage.warehouse()))
                        && (st.stages().isEmpty() || (text(st.inputLot()) && st.inputQty() > 0)));
            });
        } catch (IOException | RuntimeException ex) {
            throw new IllegalStateException("Cannot load demo dataset. Check file, JSON fields and assignments.");
        }
    }

    private static boolean text(String value) { return value != null && !value.isBlank(); }
    private static void require(boolean valid) { if (!valid) throw new IllegalArgumentException("Invalid dataset"); }
    public Station station(String terminalId) { return stations.get(terminalId); }
    LocalDate sampleDate() { return sampleDate; }

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
