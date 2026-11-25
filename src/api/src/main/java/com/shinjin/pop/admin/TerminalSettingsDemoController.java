package com.shinjin.pop.admin;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/admin/terminal-settings/{terminalId}")
public class TerminalSettingsDemoController {
    private static final String APPLIED = TerminalSettingsDemoController.class.getName() + ".applied";
    private static final Set<String> ROLES = Set.of("document", "shipment", "label");

    public record LotPolicy(String issueWarehouse, String returnWarehouse, String returnLocation) {
        public boolean allowsIssue(String warehouse) {
            return issueWarehouse == null || issueWarehouse.equals(warehouse);
        }
    }

    public synchronized void pinAtLogin(DemoSessionController.Identity identity, HttpServletRequest request) {
        var access = access(identity.terminal().id(), identity);
        if (access != null) applied(access, request, current(access), true);
    }

    public synchronized LotPolicy lotPolicy(DemoSessionController.Identity identity, HttpServletRequest request) {
        var access = access(identity.terminal().id(), identity);
        if (access == null) throw new IllegalStateException("Missing demo terminal settings");
        String id = access.scope().terminal();
        boolean alternate = applied(access, request, current(access), false)
                .values().warehouse().equals(access.catalog().warehouses().get(1));
        return switch (id) {
            case "DEMO-A" -> alternate ? new LotPolicy("WH-A2", "WH-RETURN-A2", "RET-02")
                    : new LotPolicy(null, "WH-RETURN-A", "RET-01");
            case "DEMO-B" -> alternate ? new LotPolicy("WH-B", "WH-RETURN-B", "RET-02")
                    : new LotPolicy(null, "WH-RETURN-B", "RET-01");
            default -> new LotPolicy(null, "WH-RETURN-A2", "RET-01");
        };
    }

    public record Output(String id, String role) {}
    public record Catalog(List<String> processes, List<String> warehouses, List<Output> outputs) {}
    public record Values(String process, String warehouse, Map<String, String> outputs) {}
    public record Configuration(long version, Values values) {}
    public record Update(Long expectedVersion, Values values) {}
    public record View(String terminalId, boolean canEdit, Catalog catalog,
                       Configuration saved, Configuration applied) {}
    public record Reply(String code, View view) {}
    private record Scope(String factory, String terminal) {}
    private record SessionSettings(Scope scope, Configuration configuration) {}
    private record Access(Scope scope, Catalog catalog, boolean canEdit) {}

    private final Map<Scope, Configuration> saved = new HashMap<>();

    @GetMapping
    public synchronized ResponseEntity<Reply> read(@PathVariable("terminalId") String terminalId, HttpServletRequest request) {
        var access = access(terminalId, request);
        if (access == null) return reply(403, "TERMINAL_SCOPE", null);
        return result(200, "OK", access, request, false);
    }

    @PutMapping
    public synchronized ResponseEntity<Reply> save(@PathVariable("terminalId") String terminalId,
                                                     @RequestBody Update update, HttpServletRequest request) {
        var access = access(terminalId, request);
        if (access == null || !access.canEdit()) return reply(403, "EDIT_FORBIDDEN", null);
        if (update.expectedVersion() == null || update.expectedVersion() < 0 || !valid(update.values(), access.catalog())) {
            return result(400, "INVALID_SETTINGS", access, request, false);
        }
        Configuration current = current(access);
        if (update.expectedVersion() != current.version()) {
            return result(409, "STALE_VERSION", access, request, false);
        }
        var values = update.values();

        saved.put(access.scope(), new Configuration(current.version() + 1,
                new Values(values.process(), values.warehouse(), Map.copyOf(values.outputs()))));
        return result(200, "SAVED", access, request, false);
    }

    @PostMapping("/refresh")
    public synchronized ResponseEntity<Reply> refresh(@PathVariable("terminalId") String terminalId,
                                                        HttpServletRequest request) {
        var access = access(terminalId, request);
        if (access == null) return reply(403, "TERMINAL_SCOPE", null);
        return result(200, "APPLIED", access, request, true);
    }

    private static Access access(String target, HttpServletRequest request) {
        return access(target, DemoSessionController.requireIdentity(request));
    }

    private static Access access(String target, DemoSessionController.Identity identity) {
        var terminal = identity.terminal();
        // The catalog is partitioned by the authenticated terminal and factory, never by a client-selected scope.
        if (!terminal.id().equals(target)) return null;
        String prefix = switch (terminal.id()) {
            case "DEMO-A" -> "A";
            case "DEMO-A2" -> "A2";
            case "DEMO-B" -> "B";
            default -> null;
        };
        if (prefix == null) return null;
        var scope = new Scope(terminal.factory(), terminal.id());
        boolean canEdit = switch (terminal.id()) {
            case "DEMO-A" -> "DEMO-W01".equals(identity.worker().id());
            case "DEMO-B" -> "DEMO-W03".equals(identity.worker().id());
            case "DEMO-A2" -> "DEMO-W04".equals(identity.worker().id());
            default -> false;
        };
        return new Access(scope, new Catalog(
                List.of(prefix + "-CUT", prefix + "-PACK"),
                List.of(prefix + "-STOCK", prefix + "-RETURN"),
                List.of(new Output(prefix + "-DOC", "document"), new Output(prefix + "-DOC2", "document"),
                        new Output(prefix + "-SHIP", "shipment"), new Output(prefix + "-LABEL", "label"))), canEdit);
    }

    private static boolean valid(Values values, Catalog catalog) {
        if (values == null || values.process() == null || values.warehouse() == null || values.outputs() == null
                || !catalog.processes().contains(values.process()) || !catalog.warehouses().contains(values.warehouse())
                || !values.outputs().keySet().equals(ROLES)) return false;
        return values.outputs().entrySet().stream().allMatch(entry -> catalog.outputs().stream().anyMatch(output ->
                output.role().equals(entry.getKey()) && output.id().equals(entry.getValue())));
    }

    private Configuration current(Access access) {
        return saved.computeIfAbsent(access.scope(), scope -> {
            Catalog catalog = access.catalog();
            return new Configuration(0, new Values(catalog.processes().get(0), catalog.warehouses().get(0),
                    Map.of("document", catalog.outputs().get(0).id(), "shipment", catalog.outputs().get(2).id(),
                            "label", catalog.outputs().get(3).id())));
        });
    }

    private static Configuration applied(Access access, HttpServletRequest request, Configuration latest, boolean refresh) {
        var session = request.getSession(false);
        if (!refresh) {
            if (session.getAttribute(APPLIED) instanceof SessionSettings previous
                    && previous.scope().equals(access.scope())) return previous.configuration();
            throw new IllegalStateException("Session settings were not pinned at login");
        }
        session.setAttribute(APPLIED, new SessionSettings(access.scope(), latest));
        return latest;
    }

    private ResponseEntity<Reply> result(int status, String code, Access access, HttpServletRequest request, boolean refresh) {
        var latest = current(access);
        return reply(status, code, new View(access.scope().terminal(), access.canEdit(), access.catalog(),
                latest, applied(access, request, latest, refresh)));
    }

    private static ResponseEntity<Reply> reply(int status, String code, View view) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new Reply(code, view));
    }
}
