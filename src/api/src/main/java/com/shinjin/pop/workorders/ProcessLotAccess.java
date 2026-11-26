package com.shinjin.pop.workorders;

import com.shinjin.pop.history.DemoSessionController.Identity;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class ProcessLotAccess {
    private static final Set<String> CENTERS = Set.of("001", "002", "004", "101", "102", "104");

    private ProcessLotAccess() {}

    static void require(Identity actor, Integer slot) {
        boolean allowed = !actor.groupWork() && CENTERS.contains(actor.workCenterCode())
                && actor.processSlots().stream().anyMatch(active -> active >= 1 && active <= 5
                        && (slot == null || active.equals(slot))
                        && !actor.workCodes().getOrDefault(active, "").isBlank());
        if (!allowed) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
}
