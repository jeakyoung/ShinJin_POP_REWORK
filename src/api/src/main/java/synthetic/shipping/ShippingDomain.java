package synthetic.shipping;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public interface ShippingDomain {
    enum Action { CONFIRM, CANCEL, REPRINT }
    enum Status { READY, SHIPPED, CANCELLED }

    record Scope(String factory, String site) {}
    record Actor(Scope scope, String terminal, String worker) {}
    record Handoff(String id, String packingRef, Scope scope, String shippingTerminal,
                   String lot, String item, BigDecimal quantity, boolean deferred) {}
    record Shipment(String number, Instant confirmedAt, Actor confirmedBy, Instant cancelledAt,
                    Actor cancelledBy) {}
    record Snapshot(Handoff handoff, Status status, long version, Shipment shipment, int reprintCount) {}
    record Command(String handoffId, Action action, Long expectedVersion, String requestId) {}
    record Reply(int status, String error, Snapshot snapshot) {}

    void publish(Handoff handoff);
    List<Snapshot> list(Actor actor);
    Reply execute(Actor actor, Command command);
}
