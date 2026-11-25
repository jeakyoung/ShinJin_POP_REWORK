package com.shinjin.pop.history;

import java.time.LocalDate;
import java.util.List;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class WorkHistoryController {
    public record Context(LocalDate sampleDate, List<WorkHistoryFixtures.Terminal> terminals) {}

    private final WorkHistoryFixtures fixtures;

    public WorkHistoryController(WorkHistoryFixtures fixtures) {
        this.fixtures = fixtures;
    }

    @GetMapping("/api/pop/context")
    public Context context() {
        return new Context(WorkHistoryFixtures.SAMPLE_DATE, fixtures.terminals());
    }

    @GetMapping("/api/pop/work-history")
    public List<WorkHistoryFixtures.Entry> workHistory(
            @RequestParam String terminalId,
            @RequestParam String workerId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        var terminal = fixtures.terminals().stream()
                .filter(item -> item.id().equals(terminalId))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown terminal"));

        if (terminal.workers().stream().noneMatch(worker -> worker.id().equals(workerId))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Worker does not belong to terminal");
        }

        return fixtures.find(terminalId, workerId, date);
    }
}
