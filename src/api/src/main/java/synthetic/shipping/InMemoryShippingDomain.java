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
    private final Map<String,List<String>> orderedMembers = new HashMap<>();
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
    public synchronized Reply document(Actor actor, String shipmentNumber) {
        if (!valid(actor)) return failure(401, "LOGIN_REQUIRED");
        if (blank(shipmentNumber)) return failure(404, "SHIPMENT_NOT_FOUND");
        var found = entries.values().stream().map(entry -> entry.snapshot)
                .filter(row -> row.shipment() != null && shipmentNumber.equals(row.shipment().number()))
                .findFirst().orElse(null);
        if (found == null) return failure(404, "SHIPMENT_NOT_FOUND");
        var denied = accessError(actor, found.handoff());
        if (denied != null) return denied;
        return found.status() == Status.SHIPPED ? success(found) : failure(409, "SHIPMENT_NOT_ACTIVE");
    }

    @Override
    public synchronized Reply execute(Actor actor, Command command) {
        return execute(actor, command, snapshot -> null);
    }

    public synchronized Reply execute(Actor actor, Command command, java.util.function.Function<Snapshot, String> reprint) {
        if (!valid(actor)) return failure(401, "LOGIN_REQUIRED");
        if (command == null || blank(command.handoffId()) || blank(command.requestId())
                || command.requestId().length() > 128 || command.action() == null
                || command.expectedVersion() == null || command.expectedVersion() < 0) {
            return failure(422, "INVALID_COMMAND");
        }
        Entry entry = entries.get(command.handoffId());
        if (entry == null) return failure(404, "HANDOFF_NOT_FOUND");
        Snapshot current = entry.snapshot;
        var denied = accessError(actor, current.handoff());
        if (denied != null) return denied;

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
                if (documentRows(shipment.number()).size() > 1) return failure(409, "SELECT_WHOLE_DOCUMENT");
                shipment = new Shipment(shipment.number(), shipment.confirmedAt(), shipment.confirmedBy(),
                        clock.instant(), actor);
                status = Status.CANCELLED;
            }
            case REPRINT -> {
                if (status != Status.SHIPPED) return failure(409, "SHIPMENT_NOT_ACTIVE");
                if (reprints == Integer.MAX_VALUE) return failure(409, "REPRINT_LIMIT_REACHED");
                String failure = reprint.apply(current);
                if (failure != null) return failure(422, failure);
                reprints++;
            }
        }
        Snapshot updated = new Snapshot(current.handoff(), status, current.version() + 1, shipment, reprints);
        entry.snapshot = updated;
        entry.receipts.put(command.requestId(), new Receipt(actor, command, updated));
        return success(updated);
    }

    public synchronized void markBundleReprinted(List<Snapshot> representatives) {
        for (Snapshot row : representatives) {
            Entry entry = entries.get(row.handoff().id());
            entry.snapshot = new Snapshot(row.handoff(),row.status(),row.version()+1,row.shipment(),row.reprintCount()+1);
        }
    }

    public record BatchLine(String id, long version, List<String> group) {}
    public record BatchReply(int status, String error, List<Snapshot> rows) {}

    public synchronized List<Snapshot> documentRows(String number) {
        var members = orderedMembers.get(number);
        if (members != null) return members.stream().map(id -> entries.get(id).snapshot).toList();
        return entries.values().stream().map(entry -> entry.snapshot)
                .filter(row -> row.shipment() != null && row.shipment().number().equals(number)).toList();
    }

    public synchronized BatchReply batch(Actor actor, Action action, List<BatchLine> lines) {
        if (!valid(actor)) return new BatchReply(401,"LOGIN_REQUIRED",List.of());
        if (action != Action.CONFIRM && action != Action.CANCEL || lines == null || lines.isEmpty()) {
            return new BatchReply(400,"INVALID_COMMAND",List.of());
        }
        var ids = new java.util.HashSet<String>();
        var documents = new java.util.HashSet<String>();
        for (BatchLine line : lines) {
            Entry entry = entries.get(line.id());
            if (entry == null || !ids.add(line.id())) return new BatchReply(409,"HANDOFF_NOT_FOUND",List.of());
            Snapshot row = entry.snapshot;
            var denied = accessError(actor,row.handoff());
            if (denied != null) return new BatchReply(denied.status(),denied.error(),List.of());
            if (row.version() != line.version()) return new BatchReply(409,"STALE_VERSION",List.of());
            if (action == Action.CONFIRM && row.shipment() != null) return new BatchReply(409,"SHIPMENT_ALREADY_RECORDED",List.of());
            if (action == Action.CANCEL) {
                if (row.status() != Status.SHIPPED) return new BatchReply(409,"SHIPMENT_NOT_ACTIVE",List.of());
                documents.add(row.shipment().number());
            }
        }
        if (action == Action.CANCEL && documents.stream().flatMap(number -> documentRows(number).stream())
                .anyMatch(row -> !ids.contains(row.handoff().id()))) return new BatchReply(409,"SELECT_WHOLE_DOCUMENT",List.of());
        var updated = new LinkedHashMap<String,Snapshot>();
        var numbers = new LinkedHashMap<List<String>,String>();
        var time = clock.instant();
        long next = nextShipment;
        for (BatchLine line : lines) {
            Snapshot row = entries.get(line.id()).snapshot;
            Shipment shipment;
            if (action == Action.CONFIRM) {
                String number = numbers.get(line.group());
                if (number == null) {
                    number = "SHIP-DEMO-" + next++;
                    numbers.put(line.group(),number);
                }
                shipment = new Shipment(number,time,actor,null,null);
            } else {
                Shipment old = row.shipment();
                shipment = new Shipment(old.number(),old.confirmedAt(),old.confirmedBy(),time,actor);
            }
            updated.put(line.id(),new Snapshot(row.handoff(),action==Action.CONFIRM?Status.SHIPPED:Status.CANCELLED,
                    row.version()+1,shipment,row.reprintCount()));
        }
        if (action == Action.CONFIRM) {
            var ordered = new LinkedHashMap<String,java.util.ArrayList<String>>();
            updated.forEach((id,row) -> ordered.computeIfAbsent(row.shipment().number(),
                    ignored -> new java.util.ArrayList<>()).add(id));
            ordered.forEach((number,members) -> orderedMembers.put(number,List.copyOf(members)));
        }
        updated.forEach((key,value)->entries.get(key).snapshot=value);
        nextShipment = next;
        return new BatchReply(200,null,List.copyOf(updated.values()));
    }

    private static Reply accessError(Actor actor, Handoff handoff) {
        if (!actor.scope().equals(handoff.scope())) return failure(403, "SITE_MISMATCH");
        if (!actor.terminal().equals(handoff.shippingTerminal())) return failure(403, "TERMINAL_MISMATCH");
        return null;
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
