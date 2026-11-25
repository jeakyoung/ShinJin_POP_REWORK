package com.shinjin.pop.workorders;

import java.time.LocalDate;
import java.util.List;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.context.annotation.Profile;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/work-orders")
public class WorkOrderController {
    private final WorkOrderFixtures fixtures;

    WorkOrderController(WorkOrderFixtures fixtures) {
        this.fixtures = fixtures;
    }

    @GetMapping
    List<WorkOrderFixtures.Summary> list(
            @RequestParam(required = false) WorkOrderFixtures.State status, HttpServletRequest request) {
        var terminal = DemoSessionController.requireIdentity(request).terminal();
        return fixtures.list(terminal.id(), status);
    }

    @GetMapping("/{planDate}/{planSequence}")
    WorkOrderFixtures.Detail detail(
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate planDate,
            @PathVariable int planSequence, HttpServletRequest request) {
        var terminal = DemoSessionController.requireIdentity(request).terminal();
        if (planSequence < 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid production plan sequence");
        }

        return fixtures.find(terminal.id(), planDate, planSequence)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Work order unavailable"));
    }
}
