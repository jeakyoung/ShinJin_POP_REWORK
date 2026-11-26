package com.shinjin.pop.machine;

import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.admin.EquipmentSettingsController;
import com.shinjin.pop.admin.EquipmentSettingsController.DockMachine;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@Profile("demo")
@RestController
@RequestMapping("/api/demo/machine-calls")
public class MachineCallsController {
    public record Named(String id, String name) {}
    public record Equipment(String id, String name, long openCount) {}
    public record Issue(String id, Named openedBy, String openedAt, Named reason,
                        Named closedBy, String closedAt, Named action) {}
    public record Fixture(Map<String,List<String>> terminals, List<Named> machines, List<Named> callReasons,
                          List<Named> actions, List<Named> scanEmployees) {}
    public record Detail(Named machine, List<Issue> issues, List<Named> callReasons, List<Named> actions) {}
    public record Open(UUID key, List<String> reasons) {}
    public record Scan(String action, String employeeNo) {}
    public record Approval(UUID token) {}
    public record Close(UUID key, UUID token) {}
    private record Ticket(UUID token, String machine, String issue, Named action, Named employee) {}
    private record Op(String terminal, String actor, UUID key) {}
    private record Applied(String machine, String issue, Object body, List<String> issueIds) {}
    private static final String TICKET = MachineCallsController.class.getName() + ".scan";
    private static final DateTimeFormatter TIMESTAMP = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");
    private final Fixture fixture;
    private final MachineExpendables expendables;
    private final Map<String, LinkedHashMap<String,Issue>> records = new HashMap<>();
    private final Map<Op,Applied> applied = new HashMap<>();
    private long sequence;

    public MachineCallsController(ObjectMapper mapper) throws IOException {
        try (var stream = new ClassPathResource("machine-call-fixture.json").getInputStream()) {
            fixture = mapper.readValue(stream, Fixture.class);
        }

        try (var stream = new ClassPathResource("machine-expendables-fixture.json").getInputStream()) {
            expendables = new MachineExpendables(List.of(mapper.readValue(stream,MachineExpendables.Source[].class)));
        }

    }

    @ModelAttribute
    void protect(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        DemoSessionController.requireIdentity(request);
    }

    @GetMapping
    public synchronized List<Equipment> machines(HttpServletRequest request) {
        return EquipmentSettingsController.dockMachines(request).stream().map(machine -> {
            long count = records.getOrDefault(machine.ledgerKey(),new LinkedHashMap<>()).values().stream()
                    .filter(issue -> issue.closedAt() == null).count();
            return new Equipment(machine.code(),machine.name(),count);
        }).toList();
    }

    @GetMapping("/{machine}")
    public synchronized Detail detail(@PathVariable String machine, HttpServletRequest request) {
        var selected = requireMachine(machine,request);
        return new Detail(new Named(selected.code(),selected.name()), List.copyOf(records.get(selected.ledgerKey()).values()),
                fixture.callReasons(),fixture.actions());
    }

    @GetMapping("/{machine}/expendables")
    public synchronized List<MachineExpendables.Candidate> candidates(@PathVariable String machine, HttpServletRequest request) {
        return expendables.candidates(requireMachine(machine,request));
    }

    @GetMapping("/{machine}/replacements")
    public synchronized List<MachineExpendables.Replacement> replacements(@PathVariable String machine, HttpServletRequest request) {
        return expendables.history(requireMachine(machine,request));
    }

    @PostMapping("/{machine}/replacements")
    public synchronized MachineExpendables.Result replace(@PathVariable String machine,
            @RequestBody MachineExpendables.Request command, HttpServletRequest request) {
        return expendables.accept(requireMachine(machine,request),DemoSessionController.requireIdentity(request),command);
    }

    @ExceptionHandler(MachineExpendables.Shortage.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public MachineExpendables.Changed shortage(MachineExpendables.Shortage error) {
        return new MachineExpendables.Changed("BALANCE_CHANGED",error.itemName);
    }

    @PostMapping("/{machine}/issues")
    public synchronized List<String> open(@PathVariable String machine, @RequestBody Open command, HttpServletRequest request) {
        machine = requireMachine(machine,request).ledgerKey();
        if (command.reasons() == null || command.reasons().isEmpty()) throw error(HttpStatus.BAD_REQUEST);
        var reasonIds = new HashSet<>(command.reasons());
        var reasons = fixture.callReasons().stream().filter(r -> reasonIds.contains(r.id())).toList();
        if (reasons.size() != command.reasons().size()) throw error(HttpStatus.BAD_REQUEST);
        var op = operation(request,command.key());
        var previous = replay(op,machine,null,reasons);
        if (previous != null) return previous;
        var worker = DemoSessionController.requireIdentity(request).worker();
        var actor = new Named(worker.id(),worker.name());
        String time = now();
        var ids = new ArrayList<String>();
        for (var reason : reasons) {
            String id = "CALL-" + ++sequence;
            records.get(machine).put(id,new Issue(id,actor,time,reason,null,null,null));
            ids.add(id);
        }
        applied.put(op,new Applied(machine,null,reasons,List.copyOf(ids)));
        return ids;
    }

    @PostMapping("/{machine}/issues/{issue}/scan")
    public synchronized Approval scan(@PathVariable String machine, @PathVariable String issue, @RequestBody Scan command,
                                      HttpServletRequest request) {
        machine = requireMachine(machine,request).ledgerKey();
        var session = request.getSession(false);
        session.removeAttribute(TICKET);
        openIssue(machine,issue);
        var action = named(fixture.actions(),command.action());
        var employee = named(fixture.scanEmployees(),command.employeeNo());
        var ticket = new Ticket(UUID.randomUUID(),machine,issue,action,employee);
        session.setAttribute(TICKET,ticket);
        return new Approval(ticket.token());
    }

    @PostMapping("/{machine}/issues/{issue}/close")
    public synchronized List<String> close(@PathVariable String machine, @PathVariable String issue, @RequestBody Close command,
                                          HttpServletRequest request) {
        machine = requireMachine(machine,request).ledgerKey();
        if (command.token() == null) throw error(HttpStatus.BAD_REQUEST);
        var op = operation(request,command.key());
        var previous = replay(op,machine,issue,command.token());
        if (previous != null) return previous;
        var current = openIssue(machine,issue);
        var session = request.getSession(false);
        if (!(session.getAttribute(TICKET) instanceof Ticket ticket) || !ticket.token().equals(command.token())
                || !ticket.machine().equals(machine) || !ticket.issue().equals(issue)) throw error(HttpStatus.FORBIDDEN);
        records.get(machine).put(issue,new Issue(issue,current.openedBy(),current.openedAt(),current.reason(),
                ticket.employee(),now(),ticket.action()));
        session.removeAttribute(TICKET);
        var ids = List.of(issue);
        applied.put(op,new Applied(machine,issue,command.token(),ids));
        return ids;
    }

    @DeleteMapping("/scans/{token}")
    public synchronized void cancel(@PathVariable UUID token, HttpServletRequest request) {
        var session = request.getSession(false);
        if (session.getAttribute(TICKET) instanceof Ticket ticket && ticket.token().equals(token)) session.removeAttribute(TICKET);
    }

    private Issue openIssue(String machine, String id) {
        var issue = records.get(machine).get(id);
        if (issue == null) throw error(HttpStatus.NOT_FOUND);
        if (issue.closedAt() != null) throw error(HttpStatus.CONFLICT);
        return issue;
    }

    private List<String> replay(Op op, String machine, String issue, Object body) {
        var old = applied.get(op);
        if (old == null) return null;
        if (!old.machine().equals(machine) || !Objects.equals(old.issue(),issue) || !old.body().equals(body))
            throw error(HttpStatus.CONFLICT);
        return old.issueIds();
    }

    private static Op operation(HttpServletRequest request, UUID key) {
        if (key == null) throw error(HttpStatus.BAD_REQUEST);
        var identity = DemoSessionController.requireIdentity(request);
        return new Op(identity.terminal().id(),identity.worker().id(),key);
    }

    private DockMachine requireMachine(String code,HttpServletRequest request) {
        var machine = EquipmentSettingsController.dockMachines(request).stream().filter(row -> row.code().equals(code))
                .findFirst().orElseThrow(() -> error(HttpStatus.FORBIDDEN));
        records.computeIfAbsent(machine.ledgerKey(), ignored -> new LinkedHashMap<>());
        return machine;
    }

    private static Named named(List<Named> choices, String id) {
        return choices.stream().filter(n -> n.id().equals(id)).findFirst().orElseThrow(() -> error(HttpStatus.BAD_REQUEST));
    }
    private static String now() { return LocalDateTime.now().format(TIMESTAMP); }
    private static ResponseStatusException error(HttpStatus status) { return new ResponseStatusException(status); }
}
