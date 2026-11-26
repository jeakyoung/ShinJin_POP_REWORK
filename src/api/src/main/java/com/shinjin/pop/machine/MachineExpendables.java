package com.shinjin.pop.machine;

import com.shinjin.pop.admin.EquipmentSettingsController.DockMachine;
import com.shinjin.pop.history.DemoSessionController.Identity;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Synthetic replacement stock is shared by machines in one pinned workplace. */
final class MachineExpendables {
    record Source(String lot, String sequence, String item, String name, String part, String received, int opening) {}
    record RowKey(String lot, String sequence) {}
    record Candidate(RowKey row, String name, String part, String received, int remaining) {}
    record Line(RowKey row, BigDecimal quantity) {}
    record Request(UUID key, List<Line> lines) {}
    record Replacement(String number, String machine, RowKey row, String item, String name, String part,
                       int quantity, String employeeId, String employee, LocalDateTime time) {}
    record Result(List<Replacement> replacements) {}
    record Changed(String code, String itemName) {}
    static final class Shortage extends RuntimeException {
        final String itemName;
        Shortage(String itemName) { this.itemName = itemName; }
    }
    private record Operation(String terminal, String employee, UUID key) {}
    private record Receipt(String machineKey, Map<RowKey,Integer> amounts, Result result) {}
    private final List<Source> fixture;
    private final Map<RowKey,Source> sources = new LinkedHashMap<>();
    private final Map<String,Map<RowKey,Integer>> balances = new HashMap<>();
    private final Map<String,List<Replacement>> history = new HashMap<>();
    private final Map<Operation,Receipt> receipts = new HashMap<>();
    private long sequence;

    MachineExpendables(List<Source> fixture) {
        this.fixture = List.copyOf(fixture);
        for (Source row : fixture) {
            if (row.opening() < 0 || sources.put(new RowKey(row.lot(),row.sequence()),row) != null)
                throw new IllegalArgumentException("Invalid replacement fixture");
        }
    }

    private static String workplace(DockMachine machine) {
        // EquipmentSettingsController.pin creates factory/plant/center/code from the authenticated dock.
        String suffix = "/" + machine.code();
        if (!machine.ledgerKey().endsWith(suffix)) throw new IllegalStateException("Invalid dock key");
        return machine.ledgerKey().substring(0, machine.ledgerKey().length() - suffix.length());
    }
    List<Candidate> candidates(DockMachine machine) {
        var available = balances.getOrDefault(workplace(machine), Map.of());
        return fixture.stream().map(row -> {
            RowKey key = new RowKey(row.lot(),row.sequence());
            return new Candidate(key,row.name(),row.part(),row.received(),available.getOrDefault(key,row.opening()));
        }).toList();
    }
    List<Replacement> history(DockMachine machine) {
        return history.getOrDefault(machine.ledgerKey(),List.of());
    }

    // All public operations are called under the same MachineCallsController monitor.
    Result accept(DockMachine machine, Identity identity, Request command) {
        if (command.key() == null || command.lines() == null || command.lines().isEmpty())
            throw invalid();
        var amounts = new LinkedHashMap<RowKey,Integer>();
        for (Line line : command.lines()) {
            if (line == null || line.row() == null || line.quantity() == null || !sources.containsKey(line.row())) throw invalid();
            int quantity;
            try { quantity = line.quantity().intValueExact(); }
            catch (ArithmeticException ex) { throw invalid(); }
            if (quantity < 0 || amounts.put(line.row(),quantity) != null) throw invalid();
        }
        var worker = identity.worker();
        var operation = new Operation(identity.terminal().id(),worker.id(),command.key());
        var previous = receipts.get(operation);
        if (previous != null) {
            if (!previous.machineKey().equals(machine.ledgerKey()) || !previous.amounts().equals(amounts))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"REQUEST_CHANGED");
            return previous.result();
        }
        String area = workplace(machine);
        var next = new HashMap<>(balances.getOrDefault(area,Map.of()));
        var additions = new ArrayList<Replacement>();
        long last = sequence;
        var now = LocalDateTime.now().withNano(0);
        for (var line : amounts.entrySet()) {
            int take = line.getValue();
            if (take == 0) continue; // A checked zero counts for confirmation, but writes no change row.
            var key = line.getKey();
            var source = sources.get(key);
            int left = next.getOrDefault(key,source.opening());
            if (take > left) throw new Shortage(source.name());
            next.put(key,left-take);
            additions.add(new Replacement("DEMO-CH-"+(++last), machine.name(), key, source.item(), source.name(),
                    source.part(), take, worker.id(),worker.name(),now));
        }
        var ledger = new ArrayList<>(history(machine));
        ledger.addAll(additions);
        Result result = new Result(List.copyOf(additions));
        history.put(machine.ledgerKey(),List.copyOf(ledger));
        balances.put(area,next);
        sequence = last;
        receipts.put(operation,new Receipt(machine.ledgerKey(),Map.copyOf(amounts),result));
        return result;
    }
    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_REPLACEMENT");
    }
}
