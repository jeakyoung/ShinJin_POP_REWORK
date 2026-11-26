package com.shinjin.pop.workorders;

import jakarta.servlet.http.HttpSession;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("demo")
final class GoodPlaceSelections {
    private static final String ATTRIBUTE = GoodPlaceSelections.class.getName();
    private record Scope(String terminal, LocalDate date, int sequence, int slot) {}
    private record Position(String warehouse, String location) {}
    private record Confirmed(long revision, Set<Position> places) {}
    private static final class Selections { final Map<Scope,Confirmed> rows = new HashMap<>(); }

    // The parent grid owns the draft. Remember only the pairs explicitly applied to that row in this session.
    synchronized GoodProductLocations.Place select(HttpSession session, String terminal, LocalDate date, int sequence,
            int slot, GoodProductLocations.View view, GoodProductLocations.Selection choice, GoodProductLocations catalog) {
        if (choice == null || choice.revision() != view.revision()) throw new IllegalStateException("WORK_CHANGED");
        var scope = new Scope(terminal,date,sequence,slot);
        var selections = (Selections) session.getAttribute(ATTRIBUTE);
        if (selections == null) {
            selections = new Selections();
            session.setAttribute(ATTRIBUTE, selections);
        }
        var seen = selections.rows.get(scope);
        if (seen == null || seen.revision() != view.revision()) {
            seen = new Confirmed(view.revision(), new HashSet<>());
            selections.rows.put(scope, seen);
        }
        var from = new Position(choice.fromWarehouse(),choice.fromLocation());
        var current = view.current();
        boolean fromCurrent = current != null && from.equals(new Position(current.warehouse(),current.location()));
        boolean retained = choice.location() != null && choice.location().equals(from.location())
                && (fromCurrent || seen.places().contains(from));
        var place = catalog.resolve(view.warehouses(),new GoodProductLocations.Codes(choice.warehouse(),choice.location(),slot),retained);
        seen.places().add(new Position(place.warehouse(),place.location()));
        return place;
    }

    synchronized boolean confirmed(HttpSession session, String terminal, WorkOrderFixtures.BatchRow row) {
        var values = (Selections) session.getAttribute(ATTRIBUTE);
        var selected = row.goodPlace();
        if (values == null || selected == null || selected.slot() == null) return false;
        var seen = values.rows.get(new Scope(terminal,row.date(),row.sequence(),selected.slot()));
        return seen != null && seen.revision() == row.revision()
                && seen.places().contains(new Position(selected.warehouse(),selected.location()));
    }
}
