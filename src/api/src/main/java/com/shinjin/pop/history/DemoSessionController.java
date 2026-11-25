package com.shinjin.pop.history;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Profile("demo")
@RestController
public class DemoSessionController {
    private static final String SESSION_KEY = DemoSessionController.class.getName() + ".identity";

    public record Login(String terminalId, String method, String identifier, String passcode) {}
    public record AssignedTerminal(String id, String name, String factory, String workCenter) {}
    public record Identity(AssignedTerminal terminal, WorkHistoryFixtures.Worker worker) {}

    private final WorkHistoryFixtures fixtures;

    public DemoSessionController(WorkHistoryFixtures fixtures) {
        this.fixtures = fixtures;
    }

    @PostMapping(path = "/api/pop/session", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Identity login(@RequestBody Login login, HttpServletRequest request) {
        if (login == null || login.identifier() == null || login.identifier().length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid demo login");
        }
        String identifier = login.identifier().strip();
        String workerId;
        if ("manual".equals(login.method()) && "demo-only".equals(login.passcode())) {
            workerId = identifier;
        } else if ("scan".equals(login.method()) && identifier.startsWith("SCAN:")) {
            workerId = identifier.substring("SCAN:".length());
        } else {
            throw unauthorized();
        }

        var terminal = fixtures.terminals().stream()
                .filter(item -> item.id().equals(login.terminalId()))
                .findFirst().orElseThrow(DemoSessionController::unauthorized);
        var worker = terminal.workers().stream()
                .filter(item -> item.id().equals(workerId))
                .findFirst().orElseThrow(DemoSessionController::unauthorized);

        var previous = request.getSession(false);
        if (previous != null) previous.invalidate();
        var identity = new Identity(
                new AssignedTerminal(terminal.id(), terminal.name(), terminal.factory(), terminal.workCenter()), worker);
        request.getSession(true).setAttribute(SESSION_KEY, identity);
        return identity;
    }

    @GetMapping("/api/pop/session")
    public Identity session(HttpServletRequest request) {
        return requireIdentity(request);
    }

    @PostMapping(path = "/api/pop/session/logout", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        return ResponseEntity.noContent().build();
    }

    static Identity requireIdentity(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null && session.getAttribute(SESSION_KEY) instanceof Identity identity) {
            return identity;
        }
        throw unauthorized();
    }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Demo login required");
    }
}
