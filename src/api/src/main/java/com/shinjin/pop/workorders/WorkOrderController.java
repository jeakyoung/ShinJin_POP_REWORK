package com.shinjin.pop.workorders;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.context.annotation.Profile;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/work-orders")
public class WorkOrderController {
    public record Command(WorkOrderFixtures.Action action, BigDecimal actualQuantity, Long expectedRevision,
            String lotCode, BigDecimal quantity, String warehouse, String location) {}
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

    @PostMapping(path = "/{planDate}/{planSequence}/actions", consumes = MediaType.APPLICATION_JSON_VALUE)
    WorkOrderFixtures.Detail apply(
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate planDate,
            @PathVariable int planSequence, @RequestBody Command command, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        if (planSequence < 1 || command == null || command.action() == null
                || command.expectedRevision() == null || command.expectedRevision() < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid work order command");
        }

        try {
            return fixtures.apply(identity.terminal().id(), planDate, planSequence,
                            command.action(), command.actualQuantity(), command.expectedRevision(), identity.worker().id(),
                            command.lotCode(), command.quantity(), command.warehouse(), command.location())
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Work order unavailable"));
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage());
        } catch (IllegalStateException error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, error.getMessage());
        }
    }
}
