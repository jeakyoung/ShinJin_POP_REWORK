package com.shinjin.pop.admin;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** A private, local snapshot captured from the legacy settings lookups. Never connects to MES. */
@Component
@Profile("demo")
public final class LocalSettingsReference {
    public record Choice(String code, String name) {}
    public record Site(String factory, String plant, String center, String plantName, String centerName) {}
    public record Row(int idx, String code, String name) {
        Choice choice() { return new Choice(code,name); }
    }
    public record Process(int idx, String plant, String center, String code, String name, String etc) {
        Choice choice() { return new Choice(code,name); }
    }
    public record Selection(Map<Integer,String> slots, List<String> materials, Map<String,List<String>> warehouses) {}
    public record Device(String code,String name,String description,String ownership) {}
    public record Devices(List<Device> machines,List<Device> popRows,List<String> selectedMachineCodes,boolean popFilePresent) {}
    public record Snapshot(String kind, String observedAt, String factory, String plant, String center,
                           String plantName, String centerName, String warehousePlantName, boolean machineSettingsFilePresent, List<Process> processes, List<Process> groupProcesses,
                           List<Row> warehouses, List<Row> materials, Selection originalSelection, Devices devices) {
        public Map<Integer,String> selectedSlots() {
            return originalSelection.slots().entrySet().stream().filter(e -> !e.getValue().isBlank())
                    .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey,Map.Entry::getValue));
        }
        public Optional<String> menuWorkCode(String code) {
            return processes.stream().map(Process::code).filter(code::equals).findFirst();
        }
        public Site site() { return new Site(factory,plant,center,plantName,centerName); }
    }

    private final String terminal;
    private final Snapshot snapshot;

    public LocalSettingsReference(Environment env) throws IOException {
        var file = env.getProperty("shinjin.settings-reference.file","");
        terminal = env.getProperty("shinjin.settings-reference.terminal","");
        var scope = env.getProperty("shinjin.settings-reference.scope","");
        if (file.isBlank() && terminal.isBlank() && scope.isBlank()) {
            snapshot = null;
            return;
        }
        if (file.isBlank() || terminal.isBlank() || scope.isBlank()) throw invalid();
        var path = Path.of(file);
        if (!path.isAbsolute() || !Files.isRegularFile(path)) throw invalid();
        try (var input = Files.newInputStream(path)) {
            snapshot = JsonMapper.builder().build().readValue(input,Snapshot.class);
        } catch (RuntimeException ex) {
            throw invalid();
        }
        if (snapshot == null || !"MES_READONLY_REFERENCE".equals(snapshot.kind())
                || !scope.equals(String.join("/",snapshot.factory(),snapshot.plant(),snapshot.center()))
                || snapshot.processes() == null || snapshot.groupProcesses() == null
                || snapshot.warehouses() == null || snapshot.materials() == null || snapshot.originalSelection() == null) throw invalid();
        OffsetDateTime.parse(snapshot.observedAt());
        if (snapshot.processes().stream().map(Process::code).distinct().count() != snapshot.processes().size()
                || snapshot.materials().stream().map(Row::code).distinct().count() != snapshot.materials().size()
                || snapshot.warehouses().stream().map(Row::code).distinct().count() != snapshot.warehouses().size()
                || snapshot.originalSelection().slots() == null || snapshot.originalSelection().materials() == null
                || snapshot.originalSelection().warehouses() == null
                || !snapshot.originalSelection().warehouses().keySet().equals(java.util.Set.copyOf(WarehouseSettings.ROLES))) throw invalid();
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Invalid server-local terminal reference or scope");
    }

    public Optional<Snapshot> forTerminal(String terminalId) {
        return terminal.equals(terminalId) ? Optional.ofNullable(snapshot) : Optional.empty();
    }
    public Optional<Snapshot> forSite(String terminalId, String plant, String center) {
        return forTerminal(terminalId).filter(s -> s.plant().equals(plant) && s.center().equals(center));
    }
    public Optional<Site> siteFor(String terminalId) { return forTerminal(terminalId).map(Snapshot::site); }
    public Optional<List<Choice>> processesFor(String terminalId, String plant, String center) {
        return forSite(terminalId,plant,center).map(s -> s.processes().stream().map(Process::choice).toList());
    }
    public Optional<List<Choice>> groupProcessesFor(String terminalId, String plant, String center) {
        return forSite(terminalId,plant,center).map(s -> s.groupProcesses().stream().map(Process::choice).toList());
    }
    public Optional<List<Choice>> materialsFor(String terminalId, String plant, String center) {
        return forSite(terminalId,plant,center).map(s -> s.materials().stream().map(Row::choice).toList());
    }
    public Optional<List<Choice>> warehousesFor(String terminalId, String plant, String center) {
        return forSite(terminalId,plant,center).map(s -> s.warehouses().stream().map(Row::choice).toList());
    }
}
