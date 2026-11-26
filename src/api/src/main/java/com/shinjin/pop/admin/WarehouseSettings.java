package com.shinjin.pop.admin;

import jakarta.servlet.http.HttpSession;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Called under the terminal settings controller lock, including login and plant reset. */
final class WarehouseSettings {
    static final List<String> ROLES = List.of("issue", "returns", "good", "bad", "auxiliary");
    record Scope(String factory, String terminal) {}
    record Area(String factory, String plant, String center) {}
    record Row(String code, String name, Integer idx, String plantName) {
        Row(String code, String name) { this(code, name, null, null); }
    }
    record Rules(Map<String,List<String>> roles) {
        static Rules empty() {
            var map = new LinkedHashMap<String,List<String>>();
            for (String role : ROLES) map.put(role, List.of());
            return new Rules(Map.copyOf(map));
        }
        boolean configured() { return roles.values().stream().anyMatch(list -> !list.isEmpty()); }
    }
    record Challenge(String password) {
        @Override public String toString() { return "Warehouse settings challenge"; }
    }
    record Command(String entry, Long expectedVersion, Map<String,List<String>> roles) {}
    record View(String entry, String step, long version, String plant, List<Row> rows, Rules saved, Rules applied, boolean canEdit) {}
    private record Entry(String id, Scope scope, Area area, String worker, String step, long version) {}
    private static final String ENTRY = WarehouseSettings.class.getName() + ".entry";
    private static final String APPLIED = WarehouseSettings.class.getName() + ".applied";
    private static final String HAS_SAVED = WarehouseSettings.class.getName() + ".hasSaved";
    private final Map<Scope,Rules> saved = new HashMap<>();

    Rules saved(Scope scope) { return saved.getOrDefault(scope, Rules.empty()); }
    void seed(Scope scope, Rules rules) { saved.putIfAbsent(scope,rules); }
    void clear(Scope scope) { saved.remove(scope); }
    void pin(Scope scope, HttpSession session) {
        session.setAttribute(APPLIED, saved(scope));
        session.setAttribute(HAS_SAVED,saved.containsKey(scope));
    }
    Optional<Map<String,List<String>>> pinnedRoles(HttpSession session) {
        return Boolean.TRUE.equals(session.getAttribute(HAS_SAVED)) && session.getAttribute(APPLIED) instanceof Rules rules
                ?Optional.of(rules.roles()):Optional.empty();
    }
    boolean configured(Scope scope, boolean previous) {
        return saved.containsKey(scope) ? saved(scope).configured() : previous;
    }
    static ResponseStatusException failure(HttpStatus status, String code) { return new ResponseStatusException(status, code); }

    View open(HttpSession session, Scope scope, Area area, String worker, boolean edit, long version, List<Row> rows) {
        Entry entry = new Entry(UUID.randomUUID().toString(), scope, area, worker, "selection", version);
        session.setAttribute(ENTRY, entry);
        return view(session, entry, edit, rows);
    }
    void resetEntry(HttpSession session) { session.removeAttribute(ENTRY); }
    void close(HttpSession session, Scope scope, String id) {
        if (session.getAttribute(ENTRY) instanceof Entry entry && entry.scope.equals(scope) && entry.id.equals(id))
            session.removeAttribute(ENTRY);
    }
    private View view(HttpSession session, Entry entry, boolean edit, List<Row> rows) {
        return new View(entry.id, entry.step, entry.version, entry.area.plant, rows, saved(entry.scope),
                (Rules) session.getAttribute(APPLIED), edit);
    }
    View write(HttpSession session, Scope scope, Area area, String worker, String step, Command command, long version, List<Row> rows) {
        if (!(session.getAttribute(ENTRY) instanceof Entry entry) || !entry.scope.equals(scope)
                || !entry.area.equals(area) || !entry.worker.equals(worker) || !entry.id.equals(command.entry))
            throw failure(HttpStatus.FORBIDDEN, "SETTINGS_AUTH_REQUIRED");
        if (!entry.step.equals(step) || entry.version != version || !Objects.equals(command.expectedVersion, version))
            throw failure(HttpStatus.CONFLICT, "STALE_SETTINGS");
        boolean selection = step.equals("selection");
        var codes = rows.stream().map(Row::code).toList();
        var ordered = new LinkedHashMap<String,List<String>>();
        if (command.roles == null || !command.roles.keySet().equals(Set.copyOf(ROLES)))
            throw failure(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_ROLES");
        for (var role : ROLES) {
            var list = command.roles.get(role);
            if (list == null || list.stream().anyMatch(Objects::isNull) || new HashSet<>(list).size() != list.size() || !codes.containsAll(list))
                throw failure(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_WAREHOUSE");
            if (!selection && !new HashSet<>(saved(scope).roles.get(role)).equals(new HashSet<>(list)))
                throw failure(HttpStatus.UNPROCESSABLE_ENTITY, "MEMBERSHIP_CHANGED");
            ordered.put(role, selection ? codes.stream().filter(list::contains).toList() : List.copyOf(list));
        }
        saved.put(scope, new Rules(Map.copyOf(ordered)));
        var next = new Entry(entry.id, scope, area, worker, selection ? "priority" : "done", version + 1);
        if (selection) session.setAttribute(ENTRY, next); else session.removeAttribute(ENTRY);
        return view(session, next, true, rows);
    }
}
