package synthetic.shipping;

import java.time.Clock;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class InMemoryShippingDomain implements ShippingDomain {
    private record Receipt(Actor actor, Command command, Snapshot snapshot) {}

    private static final class Entry {
        Snapshot snapshot;
        final Map<String, Receipt> receipts = new HashMap<>();

        Entry(Handoff handoff) {
            snapshot = new Snapshot(handoff, Status.READY, 0, null, 0);
        }
    }

    private final Clock clock;
    private final Map<String, Entry> entries = new LinkedHashMap<>();
    private long nextShipment = 1;

    public InMemoryShippingDomain(Clock clock) {
        this.clock = Objects.requireNonNull(clock);
    }

    @Override
    public synchronized void publish(Handoff handoff) {
        Objects.requireNonNull(handoff);
        if (blank(handoff.id()) || blank(handoff.packingRef()) || handoff.scope() == null
                || blank(handoff.scope().factory()) || blank(handoff.scope().site())
                || blank(handoff.shippingTerminal()) || blank(handoff.lot()) || blank(handoff.item())
                || handoff.quantity() == null || handoff.quantity().signum() <= 0) {
            throw new IllegalArgumentException("Invalid packing handoff");
        }
        Handoff normalized = new Handoff(handoff.id(), handoff.packingRef(), handoff.scope(),
                handoff.shippingTerminal(), handoff.lot(), handoff.item(),
                handoff.quantity().stripTrailingZeros(), handoff.deferred());
        Entry entry = entries.get(normalized.id());
        if (entry == null) {
            entries.put(normalized.id(), new Entry(normalized));
        } else if (!entry.snapshot.handoff().equals(normalized)) {
            throw new IllegalStateException("Packing handoff changed after publication");
        }
    }

    @Override
    public synchronized List<Snapshot> list(Actor actor) {
        if (!valid(actor)) return List.of();
        return entries.values().stream().map(entry -> entry.snapshot)
                .filter(snapshot -> actor.scope().equals(snapshot.handoff().scope())).toList();
    }

    @Override
    public synchronized Reply execute(Actor actor, Command command) {
        if (!valid(actor)) return failure(401, "LOGIN_REQUIRED");
        if (command == null || blank(command.handoffId()) || blank(command.requestId())
                || command.requestId().length() > 128 || command.action() == null
                || command.expectedVersion() == null || command.expectedVersion() < 0) {
            return failure(422, "INVALID_COMMAND");
        }
        Entry entry = entries.get(command.handoffId());
        if (entry == null) return failure(404, "HANDOFF_NOT_FOUND");
        Snapshot current = entry.snapshot;
        if (!actor.scope().equals(current.handoff().scope())) return failure(403, "SITE_MISMATCH");
        if (!actor.terminal().equals(current.handoff().shippingTerminal())) {
            return failure(403, "TERMINAL_MISMATCH");
        }

        Receipt original = entry.receipts.get(command.requestId());
        if (original != null) {
            if (!original.actor().equals(actor)) return failure(403, "COMMAND_ACTOR_MISMATCH");
            return original.command().equals(command)
                    ? success(original.snapshot()) : failure(409, "REQUEST_ID_REUSED");
        }
        if (command.expectedVersion() != current.version()) return failure(409, "STALE_VERSION");

        Shipment shipment = current.shipment();
        Status status = current.status();
        int reprints = current.reprintCount();
        switch (command.action()) {
            case CONFIRM -> {
                if (shipment != null) return failure(409, "SHIPMENT_ALREADY_RECORDED");
                shipment = new Shipment("SHIP-DEMO-" + nextShipment, clock.instant(), actor, null, null);
                nextShipment++;
                status = Status.SHIPPED;
            }
            case CANCEL -> {
                if (status != Status.SHIPPED) return failure(409, "SHIPMENT_NOT_ACTIVE");
                shipment = new Shipment(shipment.number(), shipment.confirmedAt(), shipment.confirmedBy(),
                        clock.instant(), actor);
                status = Status.CANCELLED;
            }
            case REPRINT -> {
                if (status != Status.SHIPPED) return failure(409, "SHIPMENT_NOT_ACTIVE");
                if (reprints == Integer.MAX_VALUE) return failure(409, "REPRINT_LIMIT_REACHED");
                reprints++;
            }
        }
        Snapshot updated = new Snapshot(current.handoff(), status, current.version() + 1, shipment, reprints);
        entry.snapshot = updated;
        entry.receipts.put(command.requestId(), new Receipt(actor, command, updated));
        return success(updated);
    }

    private static boolean valid(Actor actor) {
        return actor != null && actor.scope() != null && !blank(actor.terminal()) && !blank(actor.worker());
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static Reply success(Snapshot snapshot) {
        return new Reply(200, null, snapshot);
    }

    private static Reply failure(int status, String error) {
        return new Reply(status, error, null);
    }
}
