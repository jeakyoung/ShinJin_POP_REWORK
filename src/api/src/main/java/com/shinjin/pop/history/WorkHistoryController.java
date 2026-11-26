package com.shinjin.pop.history;

import java.time.LocalDate;
import java.util.List;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.context.annotation.Profile;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Profile("demo")
@RestController
public class WorkHistoryController {
    public record Context(LocalDate sampleDate, List<WorkHistoryFixtures.Terminal> terminals) {}

    private final WorkHistoryFixtures fixtures;

    public WorkHistoryController(WorkHistoryFixtures fixtures) {
        this.fixtures = fixtures;
    }

    @GetMapping("/api/pop/context")
    public Context context() {
        return new Context(fixtures.sampleDate(), fixtures.terminals());
    }

    @GetMapping("/api/pop/work-history")
    public List<WorkHistoryFixtures.Entry> workHistory(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return fixtures.find(identity.terminal().id(), identity.worker().id(), date);
    }
}
