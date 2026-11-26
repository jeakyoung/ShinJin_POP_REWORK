package com.shinjin.pop.admin;

import com.shinjin.pop.history.WorkHistoryFixtures.Stage;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import static com.shinjin.pop.admin.EquipmentSettingsController.*;
import static com.shinjin.pop.admin.EquipmentSettingsFixture.Item;

/** Local registry copy and the separate POP group INI snapshot taken by the assignment button. */
public record PreloginGroupState(int sequence, List<Group> groups, Group assignment, List<Stage> stages) {
    public PreloginGroupState {
        groups = List.copyOf(groups);
        stages = List.copyOf(stages);
    }

    static Optional<PreloginGroupState> read(PreloginDetailStore store, String id, String plant, String center,
                                            HttpServletRequest request) {
        return store.local(id, plant, center, "group", PreloginGroupState.class, request);
    }

    public static Optional<Group> assigned(PreloginDetailStore store, String id, String plant, String center,
                                           HttpServletRequest request) {
        return read(store, id, plant, center, request).map(PreloginGroupState::assignment);
    }

    static void pin(PreloginDetailStore store, String id, String plant, String center, HttpServletRequest request,
                    String appliedKey) {
        if (!Set.of("005", "105").contains(center)) return;
        read(store, id, plant, center, request).filter(state -> state.assignment() != null).ifPresent(state -> {
            var session = request.getSession(false);
            var saved = (LocalSettings) session.getAttribute(appliedKey);
            session.setAttribute(appliedKey, new LocalSettings(saved.machines(), state.assignment(), saved.popId()));
            session.setAttribute(appliedKey + ".stages", state.stages());
        });
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_GROUP_SETTINGS");
    }

    private static String name(List<Item> choices, String code) {
        return choices.stream().filter(item -> item.code().equals(code)).findFirst().orElseThrow(PreloginGroupState::invalid).name();
    }

    PreloginGroupState change(String operation, String terminal, String number, String side, List<Step> steps,
                              List<Item> processes, List<Item> warehouses) {
        var rows = new ArrayList<>(groups);
        if ("add".equals(operation)) {
            if (sequence >= 999) throw invalid();
            rows.add(new Group(String.format(Locale.ROOT, "%03d", sequence + 1), "", "", List.of()));
            return new PreloginGroupState(sequence + 1, rows, assignment, stages);
        }
        var row = rows.stream().filter(group -> group.number().equals(number)).findFirst().orElseThrow(PreloginGroupState::invalid);
        int index = rows.indexOf(row);
        switch (operation) {
            case "remove" -> rows.remove(index);
            case "processes" -> {
                if (steps == null || steps.isEmpty()) throw invalid();
                var unique = new HashSet<String>();
                for (Step step : steps) {
                    if (step == null || !unique.add(step.process())) throw invalid();
                    name(processes, step.process());
                    name(warehouses, step.warehouse());
                }
                rows.set(index, new Group(number, row.start(), row.end(), List.copyOf(steps)));
            }
            case "assign" -> {
                boolean start = "START".equals(side);
                if (!start && !"END".equals(side)) throw invalid();
                var pinned = row.steps().stream().map(step -> new Stage(name(processes, step.process()),
                        name(warehouses, step.warehouse()), step.process(), step.warehouse())).toList();
                rows.replaceAll(g -> new Group(g.number(), terminal.equals(g.start()) ? "" : g.start(),
                        terminal.equals(g.end()) ? "" : g.end(), g.steps()));
                var cleared = rows.get(index);
                rows.set(index, new Group(number, start ? terminal : cleared.start(), start ? cleared.end() : terminal, row.steps()));
                // frmPopGroup writes the opposite endpoint as it appeared before clearing the registry.
                var ini = new Group(number, start ? terminal : row.start(), start ? row.end() : terminal, row.steps());
                return new PreloginGroupState(sequence, rows, ini, pinned);
            }
            default -> throw invalid();
        }
        return new PreloginGroupState(sequence, rows, assignment, stages);
    }
}
