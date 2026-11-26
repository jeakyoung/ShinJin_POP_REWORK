package com.shinjin.pop.history;

import jakarta.servlet.http.HttpServletRequest;
import com.shinjin.pop.admin.TerminalSettingsDemoController;

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
    public record Identity(AssignedTerminal terminal, WorkHistoryFixtures.Worker worker, boolean groupWork, String initialView, boolean packingMenu,
                           String workCenterCode, java.util.List<Integer> processSlots, java.util.Map<Integer,String> workCodes, java.util.Map<Integer,String> workNames) {
        public Identity(AssignedTerminal terminal, WorkHistoryFixtures.Worker worker, boolean groupWork, String initialView, boolean packingMenu,
                        String center,java.util.List<Integer> slots,java.util.Map<Integer,String> codes) {
            this(terminal,worker,groupWork,initialView,packingMenu,center,slots,codes,java.util.Map.of());
        }
        public Identity withWorkNames(java.util.Map<Integer,String> names) {
            return new Identity(terminal,worker,groupWork,initialView,packingMenu,workCenterCode,processSlots,workCodes,java.util.Map.copyOf(names));
        }
        public Identity(AssignedTerminal terminal, WorkHistoryFixtures.Worker worker) { this(terminal, worker, false, "home", false, "", java.util.List.of(), java.util.Map.of()); }
    }

    private final WorkHistoryFixtures fixtures;

    private final TerminalSettingsDemoController settings;

    private final PreloginSettings prelogin;

    public DemoSessionController(WorkHistoryFixtures fixtures, TerminalSettingsDemoController settings, PreloginSettings prelogin) {
        this.fixtures = fixtures;
        this.settings = settings;
        this.prelogin = prelogin;
    }

    @PostMapping(path = "/api/pop/session", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Identity login(@RequestBody Login login, HttpServletRequest request) {
        if (login == null || login.identifier() == null || login.identifier().length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid demo login");
        }
        String identifier = login.identifier().strip();
        var terminal = fixtures.terminals().stream()
                .filter(item -> item.id().equals(login.terminalId()))
                .findFirst().orElseThrow(DemoSessionController::unauthorized);
        prelogin.checkLogin(terminal.id(),request);
        String workerId;
        if ("manual".equals(login.method()) && "demo-only".equals(login.passcode())) {
            workerId = identifier;
        } else if ("scan".equals(login.method()) && "0000".equals(identifier)) {
            workerId = TerminalSettingsDemoController.administratorId(terminal.id());
        } else if ("scan".equals(login.method()) && identifier.startsWith("SCAN:")) {
            workerId = identifier.substring("SCAN:".length());
        } else {
            throw unauthorized();
        }

        var worker = terminal.workers().stream()
                .filter(item -> item.id().equals(workerId))
                .findFirst().orElseThrow(DemoSessionController::unauthorized);

        var previous = request.getSession(false);
        if (previous != null) previous.invalidate();
        var station = fixtures.station(terminal.id());
        var identity = new Identity(
                new AssignedTerminal(terminal.id(), terminal.name(), terminal.factory(), terminal.workCenter()), worker,
                station != null && station.groupCenter(), station == null ? "home" : station.initialView(), station != null && station.packMenu(),
                station == null ? "" : station.center(), station == null ? java.util.List.of() : station.slots(), fixtures.menuProcesses(terminal.id()).slots());
        var session = request.getSession(true);
        identity = settings.pinAtLogin(identity, request);
        session.setAttribute(SESSION_KEY, identity);
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

    public static void updateProcessIdentity(Identity updated,HttpServletRequest request) {
        var current=requireIdentity(request);
        if (!current.worker().id().equals(updated.worker().id()) || !current.terminal().id().equals(updated.terminal().id()))
            throw unauthorized();
        request.getSession(false).setAttribute(SESSION_KEY,updated);
    }

    public static Identity requireIdentity(HttpServletRequest request) {
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
